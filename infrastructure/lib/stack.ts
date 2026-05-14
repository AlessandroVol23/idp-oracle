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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface IdpStackProps extends StackProps {
  oracleConnectString: string;
  oracleUser: string;
  oraclePassword: string;
  bedrockModelId: string;
}

export class IdpStack extends Stack {
  constructor(scope: Construct, id: string, props: IdpStackProps) {
    super(scope, id, props);

    const apiFn = new NodejsFunction(this, 'ApiFunction', {
      entry: join(ROOT, 'services', 'functions', 'api', 'src', 'index.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(60),
      logRetention: RetentionDays.ONE_WEEK,
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
        ORACLE_CONNECT_STRING: props.oracleConnectString,
        ORACLE_USER: props.oracleUser,
        ORACLE_PASSWORD: props.oraclePassword,
        BEDROCK_MODEL_ID: props.bedrockModelId,
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

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
  }
}
