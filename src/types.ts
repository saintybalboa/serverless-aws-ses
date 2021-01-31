import { ReceiptActionsList } from 'aws-sdk/clients/ses';

export interface Config {
  domain: string;
  hostedZoneId: string;
  emailSenderAliases: string[];
  emailReceiptRuleActions: ReceiptActionsList;
  delayEmailVerificationMs?: number;
}

export interface Commands {
  add_ses: {
    usage: string;
    lifecycleEvents: string[];
  };
  remove_ses: {
    usage: string;
    lifecycleEvents: string[];
  };
}

export interface Hooks {
  [hook: string]: Promise<void>;
}

export interface Serverless {
  service: {
    service: string;
    provider: {
      region: string;
      stage: string;
      stackName: string;
      apiGateway: {
        restApiId: string;
        websocketApiId: string;
      };
    };
    custom: {
      sesConfig: Config;
    };
  };
  providers: {
    aws: {
      sdk: {
        Route53: any;
        SES: any;
      };
      getCredentials();
      getRegion();
    };
  };
  cli: {
    log(str: string, entity?: string);
  };
}

export interface ResourceRecordValue {
  Value: string;
}

export interface ResourceRecordSet {
  Name: string;
  Type: string;
  TTL: number;
  ResourceRecords: ResourceRecordValue[];
}
