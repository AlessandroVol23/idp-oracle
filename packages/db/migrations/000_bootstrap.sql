-- Run this against the FREEPDB1 PDB as a privileged user (SYSTEM on Oracle Free,
-- ADMIN on OCI Autonomous AI). Creates the `idp` application user with the
-- minimum privileges to use DBMS_VECTOR / DBMS_VECTOR_CHAIN and to own JSON
-- Duality Views.
--
-- Replace <YOUR_IDP_PASSWORD> with the value you set in .env (ORACLE_PASSWORD).

CREATE USER idp IDENTIFIED BY "<YOUR_IDP_PASSWORD>"
  QUOTA UNLIMITED ON USERS;

GRANT DB_DEVELOPER_ROLE TO idp;
GRANT CREATE MINING MODEL TO idp;
GRANT EXECUTE ON DBMS_VECTOR TO idp;
GRANT EXECUTE ON DBMS_VECTOR_CHAIN TO idp;
GRANT EXECUTE ON CTX_DDL TO idp;
GRANT READ, WRITE ON DIRECTORY DATA_PUMP_DIR TO idp;
