/* eslint-disable no-empty */
/* eslint-disable-next-line no-empty */
import delay from 'delay';
import * as AWS from 'aws-sdk';
import * as AWSMock from 'aws-sdk-mock';
import ServerlessAwsSes from '../src/ServerlessAwsSes';
import * as verifyDomainIdentityResponse from './fixtures/verify-domain-identity-response.json';
import * as verifyDomainDkimResponse from './fixtures/verify-domain-dkim-response.json';
import * as changeResourceRecordSetsResponse from './fixtures/change-resource-recordsets-response.json';
import * as resourceRecordSetsChangedResponse from './fixtures/resource-recordsets-changed-response.json';
import { ResourceRecordSet } from '../src/types';

jest.mock('delay');

AWS.config.update({
  accessKeyId: 'test_key',
  secretAccessKey: 'test_secret',
  sessionToken: 'test_session'
});
AWS.config.region = 'us-east-1';

const getServerlessMock = () => ({
  cli: {
    log: jest.fn()
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

let serverless;
let serverlessAwsSes;

describe('ServerlessAwsSes Plugin', () => {
  it('should return a list of email addresses for each email alias specified for the domain', async () => {
    const serverlessAwsSes = new ServerlessAwsSes(getServerlessMock());

    expect(serverlessAwsSes.getRecipients()).toEqual(['no-reply@test.com', 'admin@test.com']);
  });

  it('should return a Resource Record Set with the correct values', async () => {
    const serverlessAwsSes = new ServerlessAwsSes(getServerlessMock());

    expect(serverlessAwsSes.buildResourceRecordSet('name', 'type', 123, ['value1', 'value2'])).toEqual({
      Name: 'name',
      ResourceRecords: [{ Value: 'value1' }, { Value: 'value2' }],
      TTL: 123,
      Type: 'type'
    } as ResourceRecordSet);
  });

  it('add() should invoke applyDNSChanges and addSesConfiguration', async () => {
    serverless = getServerlessMock();
    serverlessAwsSes = new ServerlessAwsSes(serverless);

    serverlessAwsSes.applyDNSChanges = jest.fn((action) => Promise.resolve());
    serverlessAwsSes.addSesConfiguration = jest.fn(() => Promise.resolve());

    await serverlessAwsSes.add();

    expect(serverlessAwsSes.applyDNSChanges).toHaveBeenCalledTimes(1);
    expect(serverlessAwsSes.addSesConfiguration).toHaveBeenCalledTimes(1);
  });

  it('remove() should invoke applyDNSChanges and removeSesConfiguration', async () => {
    serverless = getServerlessMock();
    serverlessAwsSes = new ServerlessAwsSes(serverless);

    serverlessAwsSes.applyDNSChanges = jest.fn((action) => Promise.resolve());
    serverlessAwsSes.removeSesConfiguration = jest.fn(() => Promise.resolve());

    await serverlessAwsSes.remove();

    expect(serverlessAwsSes.applyDNSChanges).toHaveBeenCalledTimes(1);
    expect(serverlessAwsSes.removeSesConfiguration).toHaveBeenCalledTimes(1);
  });

  describe('Apply DNS changes', () => {
    let verifyDomainIdentityMock;
    let verifyDomainDkimMock;
    let changeResourceRecordSetsMock;
    let resourceRecordSetsChangedMock;

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

    it('should send domain identity verification request for the config domain', async () => {
      await serverlessAwsSes.applyDNSChanges('UPSERT');

      expect(serverless.cli.log.mock.calls[0][0]).toBe(
        `Requesting Domain Identity Verification credentials for: ${serverless.service.custom.sesConfig.domain} ...`
      );
      expect(verifyDomainIdentityMock).toHaveBeenCalledTimes(1);
      expect(verifyDomainIdentityMock).toHaveBeenCalledWith({
        Domain: serverless.service.custom.sesConfig.domain
      });
    });

    it('should throw an error and log the correct message when domain identity verification request fails', async () => {
      AWSMock.restore('SES', 'verifyDomainIdentity');
      AWSMock.mock('SES', 'verifyDomainIdentity', (params) => Promise.reject('Request failed'));

      await expect(serverlessAwsSes.applyDNSChanges('UPSERT')).rejects.toBe('Request failed');

      expect(serverless.cli.log.mock.calls[1][0]).toBe(
        `Failed to send Domain Identity Verification request for ${serverless.service.custom.sesConfig.domain}`
      );
    });

    it('should send dkim verification request for the config domain', async () => {
      await serverlessAwsSes.applyDNSChanges('UPSERT');

      expect(serverless.cli.log.mock.calls[1][0]).toBe(
        `Requesting DKIM verification credentials for: ${serverless.service.custom.sesConfig.domain} ...`
      );
      expect(verifyDomainDkimMock).toHaveBeenCalledTimes(1);
      expect(verifyDomainDkimMock).toHaveBeenCalledWith({
        Domain: serverless.service.custom.sesConfig.domain
      });
    });

    it('should throw an error and log the correct message when dkim verification request fails', async () => {
      AWSMock.restore('SES', 'verifyDomainDkim');
      AWSMock.mock('SES', 'verifyDomainDkim', (params) => Promise.reject('Request failed'));

      await expect(serverlessAwsSes.applyDNSChanges('UPSERT')).rejects.toBe('Request failed');

      expect(serverless.cli.log.mock.calls[2][0]).toBe(
        `Failed to send DKIM verification request for ${serverless.service.custom.sesConfig.domain}`
      );
    });

    it('should send change resource recordsets request for the specified hosted zone', async () => {
      await serverlessAwsSes.applyDNSChanges('UPSERT');

      expect(serverless.cli.log.mock.calls[2][0]).toBe(
        `Applying DNS changes to Hosted Zone: ${serverless.service.custom.sesConfig.hostedZoneId} ...`
      );
      expect(changeResourceRecordSetsMock).toHaveBeenCalledTimes(1);
      expect(changeResourceRecordSetsMock).toHaveBeenCalledWith({
        ChangeBatch: {
          Changes: [
            {
              Action: 'UPSERT',
              ResourceRecordSet: {
                Name: '_amazonses.test.com.',
                ResourceRecords: [
                  {
                    Value: '"v3R1FICa7i0NtOk3N"'
                  }
                ],
                TTL: 1800,
                Type: 'TXT'
              }
            },
            {
              Action: 'UPSERT',
              ResourceRecordSet: {
                Name: '4kdsst27t53xxxxxxx._domainkey.test.com',
                ResourceRecords: [
                  {
                    Value: '4kdsst27t53xxxxxxx.dkim.amazonses.com'
                  }
                ],
                TTL: 1800,
                Type: 'CNAME'
              }
            },
            {
              Action: 'UPSERT',
              ResourceRecordSet: {
                Name: 'kknjqf5fxxxxxxxxxx._domainkey.test.com',
                ResourceRecords: [
                  {
                    Value: 'kknjqf5fxxxxxxxxxx.dkim.amazonses.com'
                  }
                ],
                TTL: 1800,
                Type: 'CNAME'
              }
            },
            {
              Action: 'UPSERT',
              ResourceRecordSet: {
                Name: 'znhvfp4xxxxxxxxxxx._domainkey.test.com',
                ResourceRecords: [
                  {
                    Value: 'znhvfp4xxxxxxxxxxx.dkim.amazonses.com'
                  }
                ],
                TTL: 1800,
                Type: 'CNAME'
              }
            },
            {
              Action: 'UPSERT',
              ResourceRecordSet: {
                Name: 'test.com',
                ResourceRecords: [
                  {
                    Value: '10 inbound-smtp.us-east-1.amazonaws.com'
                  }
                ],
                TTL: 300,
                Type: 'MX'
              }
            }
          ]
        },
        HostedZoneId: 'HOSTEDZONEXXXX'
      });
    });

    it('should throw an error and log the correct message when change resource recordsets request fails', async () => {
      AWSMock.restore('Route53', 'changeResourceRecordSets');
      AWSMock.mock('Route53', 'changeResourceRecordSets', (params) => Promise.reject('Request failed'));

      await expect(serverlessAwsSes.applyDNSChanges('UPSERT')).rejects.toBe('Request failed');

      expect(serverless.cli.log.mock.calls[3][0]).toBe(
        `Failed to apply DNS changes to Hosted Zone: ${serverless.service.custom.sesConfig.hostedZoneId}`
      );
    });

    it('should wait for resource recordsets changes to be applied to the specified hosted zone', async () => {
      await serverlessAwsSes.applyDNSChanges('UPSERT');

      expect(serverless.cli.log.mock.calls[3][0]).toBe('Waiting for DNS changes to be applied ...');
      expect(resourceRecordSetsChangedMock).toHaveBeenCalledTimes(1);
      expect(resourceRecordSetsChangedMock).toHaveBeenCalledWith({
        Id: changeResourceRecordSetsResponse.ChangeInfo.Id
      });
      expect(serverless.cli.log.mock.calls[4][0]).toBe(
        `DNS changes successfully applied to Hosted Zone: ${serverless.service.custom.sesConfig.hostedZoneId}`
      );
    });

    it('should throw an error and log the correct message when wait for resource recordsets request fails', async () => {
      AWSMock.restore('Route53', 'waitFor');
      AWSMock.mock('Route53', 'waitFor', (params) => Promise.reject('Request failed'));

      await expect(serverlessAwsSes.applyDNSChanges('UPSERT')).rejects.toBe('Request failed');

      expect(serverless.cli.log.mock.calls[4][0]).toBe(
        `Failed to apply DNS changes to Hosted Zone: ${serverless.service.custom.sesConfig.hostedZoneId}`
      );
    });
  });

  describe('Add SES Configuration', () => {
    let createReceiptRuleSetMock;
    let createReceiptRuleMock;
    let setActiveReceiptRuleSetMock;
    let verifyEmailIdentityMock;

    beforeEach(() => {
      createReceiptRuleSetMock = jest.fn((params) => null);
      createReceiptRuleMock = jest.fn((params) => null);
      setActiveReceiptRuleSetMock = jest.fn((params) => null);
      verifyEmailIdentityMock = jest.fn((params) => null);

      AWSMock.setSDKInstance(AWS);

      AWSMock.mock('SES', 'createReceiptRuleSet', (params: any, callback: any) => {
        callback(null, createReceiptRuleSetMock(params));
      });

      AWSMock.mock('SES', 'createReceiptRule', (params: any, callback: any) => {
        callback(null, createReceiptRuleMock(params));
      });

      AWSMock.mock('SES', 'setActiveReceiptRuleSet', (params: any, callback: any) => {
        callback(null, setActiveReceiptRuleSetMock(params));
      });

      AWSMock.mock('SES', 'verifyEmailIdentity', (params: any, callback: any) => {
        callback(null, verifyEmailIdentityMock(params));
      });

      serverless = getServerlessMock();
      serverlessAwsSes = new ServerlessAwsSes(serverless);
    });

    afterEach(() => {
      AWSMock.restore();
    });

    it('should send create receipt ruleset request with the correct name', async () => {
      await serverlessAwsSes.addSesConfiguration();

      expect(serverless.cli.log.mock.calls[0][0]).toBe('Creating SES Receipt RuleSet: EmailReceiptRuleSet ...');
      expect(createReceiptRuleSetMock).toHaveBeenCalledTimes(1);
      expect(createReceiptRuleSetMock).toHaveBeenCalledWith({
        RuleSetName: 'EmailReceiptRuleSet'
      });
    });

    it('should throw an error and log the correct message when create receipt ruleset request fails', async () => {
      AWSMock.restore('SES', 'createReceiptRuleSet');
      AWSMock.mock('SES', 'createReceiptRuleSet', (params) => Promise.reject('Request failed'));

      await expect(serverlessAwsSes.addSesConfiguration()).rejects.toBe('Request failed');

      expect(serverless.cli.log.mock.calls[1][0]).toBe('Failed to create SES Receipt RuleSet: EmailReceiptRuleSet');
    });

    it('should send create receipt rule request with the correct configuration', async () => {
      await serverlessAwsSes.addSesConfiguration();

      expect(serverless.cli.log.mock.calls[1][0]).toBe('Creating SES Receipt RuleSet entry: EmailForwarderRule ...');
      expect(createReceiptRuleMock).toHaveBeenCalledTimes(1);
      expect(createReceiptRuleMock).toHaveBeenCalledWith({
        Rule: {
          Actions: serverless.service.custom.sesConfig.emailReceiptRuleActions,
          Enabled: true,
          Name: 'EmailForwarderRule',
          Recipients: ['no-reply@test.com', 'admin@test.com']
        },
        RuleSetName: 'EmailReceiptRuleSet'
      });
    });

    it('should throw an error and log the correct message when create receipt rule request fails', async () => {
      AWSMock.restore('SES', 'createReceiptRule');
      AWSMock.mock('SES', 'createReceiptRule', (params) => Promise.reject('Request failed'));

      await expect(serverlessAwsSes.addSesConfiguration()).rejects.toBe('Request failed');

      expect(serverless.cli.log.mock.calls[2][0]).toBe('Failed to create SES Receipt RuleSet entry');
    });

    it('should send set active receipt ruleset request for the correct ruleset', async () => {
      await serverlessAwsSes.addSesConfiguration();

      expect(serverless.cli.log.mock.calls[2][0]).toBe('Setting active SES Receipt RuleSet: EmailReceiptRuleSet ...');
      expect(setActiveReceiptRuleSetMock).toHaveBeenCalledTimes(1);
      expect(setActiveReceiptRuleSetMock).toHaveBeenCalledWith({
        RuleSetName: 'EmailReceiptRuleSet'
      });
    });

    it('should throw an error and log the correct message when set active receipt ruleset request fails', async () => {
      AWSMock.restore('SES', 'setActiveReceiptRuleSet');
      AWSMock.mock('SES', 'setActiveReceiptRuleSet', (params) => Promise.reject('Request failed'));

      await expect(serverlessAwsSes.addSesConfiguration()).rejects.toBe('Request failed');

      expect(serverless.cli.log.mock.calls[3][0]).toBe('Failed to set active SES Receipt RuleSet');
    });

    it('should invoke delay with the default number of milliseconds', async () => {
      await serverlessAwsSes.addSesConfiguration();

      expect(serverless.cli.log.mock.calls[3][0]).toBe(
        'Sending a verifying request to each of the following email addresses: no-reply@test.com, admin@test.com ...'
      );
      expect(delay).toHaveBeenCalledTimes(1);
      expect(delay).toHaveBeenCalledWith(30000);
    });

    it('should invoke delay with the number of milliseconds specified in config', async () => {
      serverless = getServerlessMock();
      serverless.service.custom.sesConfig.delayEmailVerificationMs = 1000;
      serverlessAwsSes = new ServerlessAwsSes(serverless);

      await serverlessAwsSes.addSesConfiguration();

      expect(delay).toHaveBeenCalledTimes(1);
      expect(delay).toHaveBeenCalledWith(1000);
    });

    it('should send verify email identity request for each email address', async () => {
      await serverlessAwsSes.addSesConfiguration();

      expect(verifyEmailIdentityMock).toHaveBeenCalledTimes(
        serverless.service.custom.sesConfig.emailSenderAliases.length
      );
      expect(verifyEmailIdentityMock.mock.calls[0][0]).toEqual({
        EmailAddress: 'no-reply@test.com'
      });
      expect(verifyEmailIdentityMock.mock.calls[1][0]).toEqual({
        EmailAddress: 'admin@test.com'
      });
    });

    it('should throw an error and log the correct message when verify email identity request fails', async () => {
      AWSMock.restore('SES', 'verifyEmailIdentity');
      AWSMock.mock('SES', 'verifyEmailIdentity', (params) => Promise.reject('Request failed'));

      await expect(serverlessAwsSes.addSesConfiguration()).rejects.toBe('Request failed');

      expect(serverless.cli.log.mock.calls[4][0]).toBe(
        'Failed to send email verification request for one or more recipients'
      );
    });
  });

  describe('Remove SES Configuration', () => {
    let setActiveReceiptRuleSetMock;
    let deleteReceiptRuleSetMock;
    let deleteIdentityMock;

    beforeEach(() => {
      setActiveReceiptRuleSetMock = jest.fn(() => null);
      deleteReceiptRuleSetMock = jest.fn((params) => null);
      deleteIdentityMock = jest.fn((params) => null);

      AWSMock.setSDKInstance(AWS);

      AWSMock.mock('SES', 'setActiveReceiptRuleSet', (callback: any) => {
        callback(null, setActiveReceiptRuleSetMock());
      });

      AWSMock.mock('SES', 'deleteReceiptRuleSet', (params: any, callback: any) => {
        callback(null, deleteReceiptRuleSetMock(params));
      });

      AWSMock.mock('SES', 'deleteIdentity', (params: any, callback: any) => {
        callback(null, deleteIdentityMock(params));
      });

      serverless = getServerlessMock();
      serverlessAwsSes = new ServerlessAwsSes(serverless);
    });

    afterEach(() => {
      AWSMock.restore();
    });

    it('should send set active receipt ruleset request', async () => {
      await serverlessAwsSes.removeSesConfiguration();

      expect(serverless.cli.log.mock.calls[0][0]).toBe('Setting SES Receipt RuleSet to inactive ...');
      expect(setActiveReceiptRuleSetMock).toHaveBeenCalledTimes(1);
      expect(setActiveReceiptRuleSetMock).toHaveBeenCalledWith();
    });

    it('should throw an error and log the correct message when set active receipt ruleset request fails', async () => {
      AWSMock.restore('SES', 'setActiveReceiptRuleSet');
      AWSMock.mock('SES', 'setActiveReceiptRuleSet', () => Promise.reject('Request failed'));

      await expect(serverlessAwsSes.removeSesConfiguration()).rejects.toBe('Request failed');

      expect(serverless.cli.log.mock.calls[1][0]).toBe('Failed to set SES Receipt RuleSet to inactive');
    });

    it('should send delete receipt ruleset request', async () => {
      await serverlessAwsSes.removeSesConfiguration();

      expect(serverless.cli.log.mock.calls[1][0]).toBe('Deleting SES Receipt RuleSet: EmailReceiptRuleSet ...');
      expect(deleteReceiptRuleSetMock).toHaveBeenCalledTimes(1);
      expect(deleteReceiptRuleSetMock).toHaveBeenCalledWith({
        RuleSetName: 'EmailReceiptRuleSet'
      });
    });

    it('should throw an error and log the correct message when delete receipt ruleset request fails', async () => {
      AWSMock.restore('SES', 'deleteReceiptRuleSet');
      AWSMock.mock('SES', 'deleteReceiptRuleSet', (params) => Promise.reject('Request failed'));

      await expect(serverlessAwsSes.removeSesConfiguration()).rejects.toBe('Request failed');

      expect(serverless.cli.log.mock.calls[2][0]).toBe('Failed to delete SES Receipt RuleSet: EmailReceiptRuleSet');
    });

    it('should send delete identity request for each email address', async () => {
      await serverlessAwsSes.removeSesConfiguration();

      expect(deleteIdentityMock.mock.calls[0][0]).toEqual({
        Identity: 'no-reply@test.com'
      });
      expect(deleteIdentityMock.mock.calls[1][0]).toEqual({
        Identity: 'admin@test.com'
      });
    });

    it('should throw an error and log the correct message when delete identity request for the email address fails', async () => {
      AWSMock.restore('SES', 'deleteIdentity');
      AWSMock.mock('SES', 'deleteIdentity', (params) => Promise.reject('Request failed'));

      await expect(serverlessAwsSes.removeSesConfiguration()).rejects.toBe('Request failed');

      expect(serverless.cli.log.mock.calls[2][0]).toBe(
        'Removing the following email addresses: no-reply@test.com, admin@test.com ...'
      );
      expect(serverless.cli.log.mock.calls[3][0]).toBe('Failed to remove the email address of one or more recipients');
    });

    it('should send delete identity request for the specified email domain', async () => {
      await serverlessAwsSes.removeSesConfiguration();

      expect(serverless.cli.log.mock.calls[3][0]).toBe(
        `Removing the following domain from SES: ${serverless.service.custom.sesConfig.domain} ...`
      );
      expect(deleteIdentityMock.mock.calls[2][0]).toEqual({
        Identity: serverless.service.custom.sesConfig.domain
      });
    });

    it('should throw an error and log the correct message when delete identity request for the domain fails', async () => {
      let deleteIdentityRequestCount = 0;

      AWSMock.restore('SES', 'deleteIdentity');
      AWSMock.mock('SES', 'deleteIdentity', (params: any, callback: any) => {
        deleteIdentityRequestCount++;

        if (deleteIdentityRequestCount > serverless.service.custom.sesConfig.emailSenderAliases.length) {
          return Promise.reject('Request failed');
        } else {
          callback(null, deleteIdentityMock(params));
        }
      });

      await expect(serverlessAwsSes.removeSesConfiguration()).rejects.toBe('Request failed');

      expect(serverless.cli.log.mock.calls[4][0]).toBe('Failed to remove domain from SES.');
    });
  });
});
