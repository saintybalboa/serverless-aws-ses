/* eslint-disable no-empty */
/* eslint-disable-next-line no-empty */
import * as AWS from 'aws-sdk';
import * as AWSMock from 'aws-sdk-mock';
import ServerlessAwsSes from '../src/ServerlessAwsSes';
import * as verifyDomainIdentityResponse from './fixtures/verify-domain-identity-response.json';
import * as verifyDomainDkimResponse from './fixtures/verify-domain-dkim-response.json';
import * as changeResourceRecordSetsResponse from './fixtures/change-resource-recordsets-response.json';
import * as resourceRecordSetsChangedResponse from './fixtures/resource-recordsets-changed-response.json';
import { Commands, Config, Hooks, ResourceRecordSet, Serverless } from '../src/types';
import { Route53 } from 'aws-sdk';
import { stringify } from 'querystring';

AWS.config.update({
  accessKeyId: 'test_key',
  secretAccessKey: 'test_secret',
  sessionToken: 'test_session',
});
AWS.config.region = 'us-east-1';

const getServerlessMock = () => ({
  cli: {
    log: jest.fn(),
    consoleLog: (str: any) => {}
  },
  providers: {
    aws: {
      getCredentials: () => null,
      getRegion: () => 'us-east-1',
      sdk: {
        SES: AWS.SES,
        Route53: AWS.Route53,
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
        domain: 'test.com',
        hostedZoneId: 'HOSTEDZONEXXXX',
        emailSenderAliases: ['no-reply', 'admin'],
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
});

let verifyDomainIdentityMock;
let verifyDomainDkimMock;
let changeResourceRecordSetsMock;
let resourceRecordSetsChangedMock;
let serverless;
let serverlessAwsSes;

describe('ServerlessAwsSes Plugin', () => {
  beforeEach(() => {
    verifyDomainIdentityMock = jest.fn((params) => verifyDomainIdentityResponse);
    verifyDomainDkimMock = jest.fn((params) => verifyDomainDkimResponse);
    changeResourceRecordSetsMock = jest.fn((params) => changeResourceRecordSetsResponse);
    resourceRecordSetsChangedMock = jest.fn((params) => resourceRecordSetsChangedResponse);

    AWSMock.setSDKInstance(AWS);

    AWSMock.mock('SES', 'verifyDomainIdentity', (params: any, callback: any) => {
      callback(null, verifyDomainIdentityMock(params));
    });

    AWSMock.mock('SES', 'verifyDomainDkim', (params: any, callback: any) => {
      callback(null, verifyDomainDkimMock(params));
    });

    AWSMock.mock('Route53', 'changeResourceRecordSets', (params: any, callback: any) => {
      callback(null, changeResourceRecordSetsMock(params));
    });

    AWSMock.mock('Route53', 'waitFor', (state: string, params: any, callback: any) => {
      callback(null, resourceRecordSetsChangedMock(params));
    });

    serverless = getServerlessMock();
    serverlessAwsSes = new ServerlessAwsSes(serverless);
  });

  afterEach(() => {
    AWSMock.restore();
  });

  it('should return a list of email addresses for each email alias specified for the domain', async () => {
    const serverlessAwsSes = new ServerlessAwsSes(getServerlessMock());

    expect(serverlessAwsSes.getRecipients()).toEqual(['no-reply@test.com', 'admin@test.com']);
  });

  it('should return a Resource Record Set with the correct values', async () => {
    const serverlessAwsSes = new ServerlessAwsSes(getServerlessMock());

    expect(serverlessAwsSes.buildResourceRecordSet('name', 'type', 123, ['value1', 'value2']))
      .toEqual({
        Name: 'name',
        ResourceRecords: [
          { Value: 'value1' },
          { Value: 'value2' }
        ],
        TTL: 123,
        Type: 'type'
      } as ResourceRecordSet);
  });

  describe('Apply DNS changes', () => {
    it('should send domain identity verification request for the config domain', async () => {
      await serverlessAwsSes.applyDNSChanges('UPSERT');

      expect(serverless.cli.log.mock.calls[0][0]).toBe(`Requesting Domain Identity Verification credentials for: ${serverless.service.custom.sesConfig.domain} ...`);
      expect(verifyDomainIdentityMock).toHaveBeenCalledTimes(1);
      expect(verifyDomainIdentityMock).toHaveBeenCalledWith({
        Domain: serverless.service.custom.sesConfig.domain
      });
    });

    it('should throw an error and log the correct message when domain identity verification request fails', async () => {
      verifyDomainIdentityMock = jest.fn((params) => Promise.reject('Request failed'));

      AWSMock.restore('SES', 'verifyDomainIdentity');
      AWSMock.mock('SES', 'verifyDomainIdentity', verifyDomainIdentityMock);

      try {
        await serverlessAwsSes.applyDNSChanges('UPSERT');
      } catch (error) {
        expect(error).toBe('Request failed');
      }

      expect(verifyDomainIdentityMock).rejects.toThrow();
      expect(serverless.cli.log.mock.calls[1][0]).toBe(`Failed to send Domain Identity Verification request for ${serverless.service.custom.sesConfig.domain}`);
    });

    it('should send dkim verification request for the config domain', async () => {
      await serverlessAwsSes.applyDNSChanges('UPSERT');

      expect(serverless.cli.log.mock.calls[1][0]).toBe(`Requesting DKIM verification credentials for: ${serverless.service.custom.sesConfig.domain} ...`);
      expect(verifyDomainDkimMock).toHaveBeenCalledTimes(1);
      expect(verifyDomainDkimMock).toHaveBeenCalledWith({
        Domain: serverless.service.custom.sesConfig.domain
      });
    });

    it('should throw an error and log the correct message when dkim verification request fails', async () => {
      verifyDomainDkimMock = jest.fn((params) => Promise.reject('Request failed'));

      AWSMock.restore('SES', 'verifyDomainDkim');
      AWSMock.mock('SES', 'verifyDomainDkim', verifyDomainDkimMock);

      try {
        await serverlessAwsSes.applyDNSChanges('UPSERT');
      } catch (error) {
        expect(error).toBe('Request failed');
      }

      expect(verifyDomainDkimMock).rejects.toThrow();
      expect(serverless.cli.log.mock.calls[2][0]).toBe(`Failed to send DKIM verification request for ${serverless.service.custom.sesConfig.domain}`);
    });

    it('should send change resource recordsets request for the specified hosted zone', async () => {
      await serverlessAwsSes.applyDNSChanges('UPSERT');

      expect(serverless.cli.log.mock.calls[2][0]).toBe(`Applying DNS changes to Hosted Zone: ${serverless.service.custom.sesConfig.hostedZoneId} ...`);
      expect(changeResourceRecordSetsMock).toHaveBeenCalledTimes(1);
      expect(changeResourceRecordSetsMock).toHaveBeenCalledWith({
        'ChangeBatch': {
          'Changes': [
            {
              'Action': 'UPSERT',
              'ResourceRecordSet': {
                'Name': '_amazonses.test.com.',
                'ResourceRecords': [
                  {
                    'Value': '"v3R1FICa7i0NtOk3N"',
                  },
                ],
                'TTL': 1800,
                'Type': 'TXT',
              },
            },
            {
              'Action': 'UPSERT',
              'ResourceRecordSet': {
                'Name': '4kdsst27t53xxxxxxx._domainkey.test.com',
                'ResourceRecords': [
                  {
                    'Value': '4kdsst27t53xxxxxxx.dkim.amazonses.com',
                  },
                ],
                'TTL': 1800,
                'Type': 'CNAME',
              },
            },
            {
              'Action': 'UPSERT',
              'ResourceRecordSet': {
                'Name': 'kknjqf5fxxxxxxxxxx._domainkey.test.com',
                'ResourceRecords': [
                  {
                    'Value': 'kknjqf5fxxxxxxxxxx.dkim.amazonses.com',
                  },
                ],
                'TTL': 1800,
                'Type': 'CNAME',
              },
            },
            {
              'Action': 'UPSERT',
              'ResourceRecordSet': {
                'Name': 'znhvfp4xxxxxxxxxxx._domainkey.test.com',
                'ResourceRecords': [
                  {
                    'Value': 'znhvfp4xxxxxxxxxxx.dkim.amazonses.com',
                  },
                ],
                'TTL': 1800,
                'Type': 'CNAME',
              },
            },
            {
              'Action': 'UPSERT',
              'ResourceRecordSet': {
                'Name': 'test.com',
                'ResourceRecords': [
                  {
                    'Value': '10 inbound-smtp.us-east-1.amazonaws.com',
                  },
                ],
                'TTL': 300,
                'Type': 'MX',
              },
            },
          ],
        },
        'HostedZoneId': 'HOSTEDZONEXXXX',
      });
    });

    it('should throw an error and log the correct message when change resource recordsets request fails', async () => {
      changeResourceRecordSetsMock = jest.fn((params) => Promise.reject('Request failed'));

      AWSMock.restore('Route53', 'changeResourceRecordSets');
      AWSMock.mock('Route53', 'changeResourceRecordSets', changeResourceRecordSetsMock);

      try {
        await serverlessAwsSes.applyDNSChanges('UPSERT');
      } catch (error) {
        expect(error).toBe('Request failed');
      }

      expect(changeResourceRecordSetsMock).rejects.toThrow();
      expect(serverless.cli.log.mock.calls[3][0]).toBe(`Failed to apply DNS changes to Hosted Zone: ${serverless.service.custom.sesConfig.hostedZoneId}`);
    });

    it('should wait for resource recordsets changes to be applied to the specified hosted zone', async () => {
      await serverlessAwsSes.applyDNSChanges('UPSERT');

      expect(serverless.cli.log.mock.calls[3][0]).toBe('Waiting for DNS changes to be applied ...');
      expect(resourceRecordSetsChangedMock).toHaveBeenCalledTimes(1);
      expect(resourceRecordSetsChangedMock).toHaveBeenCalledWith({
        Id: changeResourceRecordSetsResponse.ChangeInfo.Id
      });
      expect(serverless.cli.log.mock.calls[4][0]).toBe(`DNS changes successfully applied to Hosted Zone: ${serverless.service.custom.sesConfig.hostedZoneId}`);
    });

    it('should throw an error and log the correct message when wait for resource recordsets request fails', async () => {
      resourceRecordSetsChangedMock = jest.fn((state, params, callback) => Promise.reject('Request failed'));

      AWSMock.restore('Route53', 'waitFor');
      AWSMock.mock('Route53', 'waitFor', resourceRecordSetsChangedMock);

      try {
        await serverlessAwsSes.applyDNSChanges('UPSERT');
      } catch (error) {
        expect(error).toBe('Request failed');
      }

      expect(resourceRecordSetsChangedMock).rejects.toThrow();
      expect(serverless.cli.log.mock.calls[4][0]).toBe(`Failed to apply DNS changes to Hosted Zone: ${serverless.service.custom.sesConfig.hostedZoneId}`);
    });
  });
});
