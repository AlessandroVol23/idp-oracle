import { Stack, type StackProps, Duration, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { Bucket, BlockPublicAccess, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import {
  Distribution,
  ViewerProtocolPolicy,
  CachePolicy,
  AllowedMethods,
  PriceClass,
  ResponseHeadersPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Function, FunctionUrlAuthType, Runtime, Architecture, InvokeMode } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
  Vpc,
  IpAddresses,
  SubnetType,
  SecurityGroup,
  Port,
  BastionHostLinux,
  InstanceType,
  InstanceClass,
  InstanceSize,
} from 'aws-cdk-lib/aws-ec2';
import { FileSystem, PerformanceMode, ThroughputMode } from 'aws-cdk-lib/aws-efs';
import {
  Cluster,
  FargateTaskDefinition,
  FargateService,
  ContainerImage,
  LogDriver,
  CpuArchitecture,
  OperatingSystemFamily,
  FargatePlatformVersion,
} from 'aws-cdk-lib/aws-ecs';
import { PrivateDnsNamespace, DnsRecordType } from 'aws-cdk-lib/aws-servicediscovery';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ORACLE_NAMESPACE = 'idp.local';
const ORACLE_SERVICE_NAME = 'oracle';
const ORACLE_PDB = 'FREEPDB1';
const ORACLE_CONTAINER_UID = '54321';
const ORACLE_CONTAINER_GID = '54321';

export interface IdpStackProps extends StackProps {
  oraclePassword: string;
  bedrockModelId: string;
}

export class IdpStack extends Stack {
  constructor(scope: Construct, id: string, props: IdpStackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'Vpc', {
      ipAddresses: IpAddresses.cidr('10.42.0.0/16'),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    const dbSg = new SecurityGroup(this, 'DbSg', {
      vpc,
      description: 'Oracle DB Fargate task',
      allowAllOutbound: true,
    });
    const lambdaSg = new SecurityGroup(this, 'LambdaSg', {
      vpc,
      description: 'IDP Lambda API',
      allowAllOutbound: true,
    });
    const bastionSg = new SecurityGroup(this, 'BastionSg', {
      vpc,
      description: 'SSM bastion for migrations + ONNX upload',
      allowAllOutbound: true,
    });
    dbSg.addIngressRule(lambdaSg, Port.tcp(1521), 'Lambda → Oracle');
    dbSg.addIngressRule(bastionSg, Port.tcp(1521), 'Bastion → Oracle');

    const efsSg = new SecurityGroup(this, 'EfsSg', { vpc, description: 'EFS for Oracle data' });
    efsSg.addIngressRule(dbSg, Port.tcp(2049), 'Oracle task → NFS');
    efsSg.addIngressRule(bastionSg, Port.tcp(2049), 'Bastion → NFS');

    const fs = new FileSystem(this, 'OracleData', {
      vpc,
      securityGroup: efsSg,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      encrypted: true,
      performanceMode: PerformanceMode.GENERAL_PURPOSE,
      throughputMode: ThroughputMode.ELASTIC,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const oradataAp = fs.addAccessPoint('OradataAp', {
      path: '/oradata',
      createAcl: { ownerUid: ORACLE_CONTAINER_UID, ownerGid: ORACLE_CONTAINER_GID, permissions: '755' },
      posixUser: { uid: ORACLE_CONTAINER_UID, gid: ORACLE_CONTAINER_GID },
    });
    const dpdumpAp = fs.addAccessPoint('DpdumpAp', {
      path: '/dpdump',
      createAcl: { ownerUid: ORACLE_CONTAINER_UID, ownerGid: ORACLE_CONTAINER_GID, permissions: '755' },
      posixUser: { uid: ORACLE_CONTAINER_UID, gid: ORACLE_CONTAINER_GID },
    });

    const cluster = new Cluster(this, 'Cluster', { vpc, containerInsights: false });

    const namespace = new PrivateDnsNamespace(this, 'Namespace', {
      vpc,
      name: ORACLE_NAMESPACE,
    });

    const taskDef = new FargateTaskDefinition(this, 'OracleTask', {
      cpu: 4096,
      memoryLimitMiB: 16384,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.X86_64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });

    taskDef.addVolume({
      name: 'oradata',
      efsVolumeConfiguration: {
        fileSystemId: fs.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: { accessPointId: oradataAp.accessPointId, iam: 'ENABLED' },
      },
    });
    taskDef.addVolume({
      name: 'dpdump',
      efsVolumeConfiguration: {
        fileSystemId: fs.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: { accessPointId: dpdumpAp.accessPointId, iam: 'ENABLED' },
      },
    });
    fs.grantReadWrite(taskDef.taskRole);

    const oracleContainer = taskDef.addContainer('oracle', {
      image: ContainerImage.fromRegistry('container-registry.oracle.com/database/free:latest-lite'),
      logging: LogDriver.awsLogs({ streamPrefix: 'oracle', logRetention: RetentionDays.ONE_WEEK }),
      environment: { ORACLE_PWD: props.oraclePassword },
      portMappings: [{ containerPort: 1521 }],
      essential: true,
    });
    oracleContainer.addMountPoints(
      { containerPath: '/opt/oracle/oradata', sourceVolume: 'oradata', readOnly: false },
      { containerPath: '/opt/oracle/admin/FREE/dpdump', sourceVolume: 'dpdump', readOnly: false },
    );

    const dbService = new FargateService(this, 'DbService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      platformVersion: FargatePlatformVersion.LATEST,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSg],
      enableExecuteCommand: true,
      assignPublicIp: false,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      cloudMapOptions: {
        name: ORACLE_SERVICE_NAME,
        cloudMapNamespace: namespace,
        dnsRecordType: DnsRecordType.A,
        dnsTtl: Duration.seconds(10),
      },
      healthCheckGracePeriod: Duration.minutes(10),
    });

    const bastion = new BastionHostLinux(this, 'Bastion', {
      vpc,
      subnetSelection: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroup: bastionSg,
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.NANO),
    });

    const oracleConnectString = `${ORACLE_SERVICE_NAME}.${ORACLE_NAMESPACE}:1521/${ORACLE_PDB}`;

    const apiFn = new NodejsFunction(this, 'ApiFunction', {
      entry: join(ROOT, 'services', 'functions', 'api', 'src', 'index.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(60),
      logRetention: RetentionDays.ONE_WEEK,
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSg],
      bundling: {
        format: OutputFormat.ESM,
        target: 'node20',
        minify: false,
        sourceMap: true,
        externalModules: ['oracledb'],
        mainFields: ['module', 'main'],
        banner:
          "import { createRequire as topLevelCreateRequire } from 'module'; const require = topLevelCreateRequire(import.meta.url);",
      },
      environment: {
        ORACLE_CONNECT_STRING: oracleConnectString,
        ORACLE_USER: 'idp',
        ORACLE_PASSWORD: props.oraclePassword,
        BEDROCK_MODEL_ID: props.bedrockModelId,
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    apiFn.node.addDependency(dbService);

    const region = props.env?.region ?? this.region;
    apiFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${region}::foundation-model/${props.bedrockModelId}`,
          `arn:aws:bedrock:*::foundation-model/${props.bedrockModelId}`,
        ],
      }),
    );

    const fnUrl = apiFn.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      invokeMode: InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [
          (Function as unknown as { ALL?: unknown }).ALL as never,
        ] as never[],
        allowedHeaders: ['*'],
      },
    });

    const siteBucket = new Bucket(this, 'WebBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new Distribution(this, 'WebDistribution', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      defaultRootObject: 'index.html',
      priceClass: PriceClass.PRICE_CLASS_100,
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
      ],
    });

    new CfnOutput(this, 'ApiUrl', { value: fnUrl.url });
    new CfnOutput(this, 'WebUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'WebBucketName', { value: siteBucket.bucketName });
    new CfnOutput(this, 'WebDistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'OracleConnectString', { value: oracleConnectString });
    new CfnOutput(this, 'BastionInstanceId', { value: bastion.instanceId });
    new CfnOutput(this, 'EcsClusterName', { value: cluster.clusterName });
    new CfnOutput(this, 'EcsDbServiceName', { value: dbService.serviceName });
  }
}
