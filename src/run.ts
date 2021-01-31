import * as aws from 'aws-sdk';
import ServerlessAwsSes from './ServerlessAwsSes';

const consoleOutput = [];
const serverless = {
  cli: {
    log(str: string) {
      consoleOutput.push(str);
      console.log(str);
    },
    consoleLog(str: any) {
      consoleOutput.push(str);
      console.log(str);
    }
  },
  providers: {
    aws: {
      getCredentials: () => null,
      getRegion: () => 'us-east-1',
      sdk: {
        ACM: aws.ACM,
        APIGateway: aws.APIGateway,
        ApiGatewayV2: aws.ApiGatewayV2,
        CloudFormation: aws.CloudFormation,
        SES: aws.SES,
        Route53: aws.Route53,
        Route53Domains: aws.Route53Domains,
        config: {
          update: (toUpdate: any) => null
        }
      }
    }
  },
  service: {
    init: () => null,
    custom: {
      sesConfig: {
        domain: 'notifications.msswebdevelopment.com',
        hostedZoneId: 'Z07322902JUNGBOS2J6V6',
        emailSenderAliases: ['no-reply'],
        topicArn: 'arn:aws:sns:us-east-1:735329018584:ServerlessDemoEmailForwarder',
        emailReceiptRuleActions: [
          {
            SNSAction: {
              TopicArn: 'arn:aws:sns:us-east-1:735329018584:ServerlessDemoEmailForwarder',
              Encoding: 'UTF-8'
            }
          }
        ]
      }
    },
    provider: {
      apiGateway: {
        restApiId: null,
        websocketApiId: null
      },
      compiledCloudFormationTemplate: {
        Outputs: null
      },
      stackName: 'custom-stage-name',
      stage: 'test',
      region: 'us-east-1'
    },
    service: 'test'
  }
};

const serverlessAwsSes = new ServerlessAwsSes(serverless);

Promise.all([
  serverlessAwsSes.remove().catch((error) => {
    throw error;
  })
]).then(() => {
  serverlessAwsSes.add().catch((error) => {
    throw error;
  });
});

// serverlessAwsSes.addSes().catch((error) => { throw error; });
