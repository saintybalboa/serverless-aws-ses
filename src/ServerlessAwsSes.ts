import delay from 'delay';
import { Route53, SES } from 'aws-sdk';
import { Commands, Config, Hooks, ResourceRecordSet, Serverless } from './types';
import { Error } from 'aws-sdk/clients/servicecatalog';

/**
 * Create a new instance.
 *
 * @param {Serverless} serverless the Serverless instance
 */
export default class ServerlessAwsSes {
  private ses: SES;
  private serverless: Serverless;
  private service: any;
  private config: Config;
  private hooks: Hooks;
  private commands: Commands;
  private route53: Route53;
  private emailReceiptRuleSetName = 'EmailReceiptRuleSet';
  private emailReceiptRuleName = 'EmailForwarderRule';
  private delayEmailVerificationMs = 30000;

  constructor(serverless: Serverless) {
    this.serverless = serverless;
    this.service = this.serverless.service;
    this.commands = {
      add_ses: {
        lifecycleEvents: ['add'],
        usage: 'Adds configuration to use custom email address to use SES'
      },
      remove_ses: {
        lifecycleEvents: ['remove'],
        usage: 'Removes configuration for custom email addresses from SES'
      }
    };
    this.hooks = {
      'add_ses:add': this.add.bind(this),
      'remove_ses:remove': this.remove.bind(this),
      'before:remove:remove': this.remove.bind(this),
      'after:deploy:deploy': this.add.bind(this)
    };

    this.config = this.service.custom['sesConfig'];

    if (this.config.delayEmailVerificationMs) {
      this.delayEmailVerificationMs = this.config.delayEmailVerificationMs;
    }

    this.route53 = new this.serverless.providers.aws.sdk.Route53({ region: this.service.provider.region });
    this.ses = new this.serverless.providers.aws.sdk.SES({ region: this.service.provider.region });
  }

  /**
   * Add AWS SES configuration including relevant DNS records
   */
  public async add(): Promise<void | Error> {
    await this.applyDNSChanges('UPSERT');
    await this.addSesConfiguration();
  }

  /**
   * Remove AWS SES configuration including relevant  DNS records
   */
  public async remove(): Promise<void | Error> {
    await this.applyDNSChanges('DELETE');
    await this.removeSesConfiguration();
  }

  /**
   * Build Route53 resource recordset
   *
   * @param name: string
   * @param type: string
   * @param tl: number
   * @param values: string[]
   *
   * @return ResourceRecord
   */
  public buildResourceRecordSet(name: string, type: string, ttl: number, values: string[]): ResourceRecordSet {
    return {
      Name: name,
      Type: type,
      TTL: ttl,
      ResourceRecords: values.map((value) => ({
        Value: value
      }))
    };
  }

  /**
   * Remove AWS SES configuration including DNS records
   *
   * @return string[]
   */
  public getRecipients(): string[] {
    return this.config.emailSenderAliases.map((emailAlias) => `${emailAlias}@${this.config.domain}`);
  }

  /**
   * Apply DNS record changes
   *
   * @param action: string
   *
   * @return Promose<void>
   */
  public async applyDNSChanges(action: string): Promise<void | Error> {
    const hostedZoneRecordSets = [];

    this.serverless.cli.log(`Requesting Domain Identity Verification credentials for: ${this.config.domain} ...`);

    const domainIdentityVerificationCreds = await this.ses
      .verifyDomainIdentity({
        Domain: this.config.domain
      })
      .promise()
      .catch((error) => {
        this.serverless.cli.log(`Failed to send Domain Identity Verification request for ${this.config.domain}`);
        throw error;
      });

    hostedZoneRecordSets.push({
      Action: action,
      ResourceRecordSet: this.buildResourceRecordSet(`_amazonses.${this.config.domain}.`, 'TXT', 1800, [
        `"${domainIdentityVerificationCreds.VerificationToken}"`
      ])
    });

    this.serverless.cli.log(`Requesting DKIM verification credentials for: ${this.config.domain} ...`);

    const domainDkimVerificationCreds = await this.ses
      .verifyDomainDkim({
        Domain: this.config.domain
      })
      .promise()
      .catch((error) => {
        this.serverless.cli.log(`Failed to send DKIM verification request for ${this.config.domain}`);
        throw error;
      });

    domainDkimVerificationCreds.DkimTokens.forEach((domainDkimToken) => {
      hostedZoneRecordSets.push({
        Action: action,
        ResourceRecordSet: this.buildResourceRecordSet(
          `${domainDkimToken}._domainkey.${this.config.domain}`,
          'CNAME',
          1800,
          [`${domainDkimToken}.dkim.amazonses.com`]
        )
      });
    });

    hostedZoneRecordSets.push({
      Action: action,
      ResourceRecordSet: this.buildResourceRecordSet(this.config.domain, 'MX', 300, [
        '10 inbound-smtp.us-east-1.amazonaws.com'
      ])
    });

    this.serverless.cli.log(`Applying DNS changes to Hosted Zone: ${this.config.hostedZoneId} ...`);

    const changeResourceRecordSets = await this.route53
      .changeResourceRecordSets({
        HostedZoneId: this.config.hostedZoneId,
        ChangeBatch: {
          Changes: hostedZoneRecordSets
        }
      })
      .promise()
      .catch((error) => {
        this.serverless.cli.log(`Failed to apply DNS changes to Hosted Zone: ${this.config.hostedZoneId}`);
        throw error;
      });

    this.serverless.cli.log('Waiting for DNS changes to be applied ...');

    await this.route53
      .waitFor('resourceRecordSetsChanged', {
        Id: changeResourceRecordSets.ChangeInfo.Id
      })
      .promise()
      .catch((error) => {
        this.serverless.cli.log(`Failed to apply DNS changes to Hosted Zone: ${this.config.hostedZoneId}`);
        throw error;
      });

    this.serverless.cli.log(`DNS changes successfully applied to Hosted Zone: ${this.config.hostedZoneId}`);
  }

  /**
   * Remove AWS SES configuration including sender email addresses
   *
   * @return Promise<void>
   */
  public async removeSesConfiguration(): Promise<void | Error> {
    const recipients = this.getRecipients();

    this.serverless.cli.log('Setting SES Receipt RuleSet to inactive ...');
    // Set the active Receipt RuleSet to inactive by not specifying a RuleSetName in the params
    await this.ses
      .setActiveReceiptRuleSet()
      .promise()
      .catch((error) => {
        this.serverless.cli.log('Failed to set SES Receipt RuleSet to inactive');
        throw error;
      });

    this.serverless.cli.log(`Deleting SES Receipt RuleSet: ${this.emailReceiptRuleSetName} ...`);

    await this.ses
      .deleteReceiptRuleSet({
        RuleSetName: this.emailReceiptRuleSetName
      })
      .promise()
      .catch((error) => {
        this.serverless.cli.log(`Failed to delete SES Receipt RuleSet: ${this.emailReceiptRuleSetName}`);
        throw error;
      });

    this.serverless.cli.log(`Removing the following email addresses: ${recipients.join(', ')} ...`);

    await Promise.all(
      recipients.map(async (recipientEmailAddress) => {
        await this.ses
          .deleteIdentity({
            Identity: recipientEmailAddress
          })
          .promise();
      })
    ).catch((error) => {
      this.serverless.cli.log('Failed to remove the email address of one or more recipients');
      throw error;
    });

    this.serverless.cli.log(`Removing the following domain from SES: ${this.config.domain} ...`);

    await this.ses
      .deleteIdentity({
        Identity: this.config.domain
      })
      .promise()
      .catch((error) => {
        this.serverless.cli.log('Failed to remove domain from SES.');
        throw error;
      });
  }

  /**
   * Add AWS SES configuration to setup sender email addresses
   *
   * @return Promise<void>
   */
  public async addSesConfiguration(): Promise<void | Error> {
    const recipients = this.getRecipients();

    this.serverless.cli.log(`Creating SES Receipt RuleSet: ${this.emailReceiptRuleSetName} ...`);

    await this.ses
      .createReceiptRuleSet({
        RuleSetName: this.emailReceiptRuleSetName
      })
      .promise()
      .catch((error) => {
        this.serverless.cli.log(`Failed to create SES Receipt RuleSet: ${this.emailReceiptRuleSetName}`);
        throw error;
      });

    this.serverless.cli.log(`Creating SES Receipt RuleSet entry: ${this.emailReceiptRuleName} ...`);

    await this.ses
      .createReceiptRule({
        Rule: {
          Name: this.emailReceiptRuleName,
          Actions: this.config.emailReceiptRuleActions,
          Enabled: true,
          Recipients: this.getRecipients()
        },
        RuleSetName: this.emailReceiptRuleSetName
      })
      .promise()
      .catch((error) => {
        this.serverless.cli.log('Failed to create SES Receipt RuleSet entry');
        throw error;
      });

    this.serverless.cli.log(`Setting active SES Receipt RuleSet: ${this.emailReceiptRuleSetName} ...`);

    await this.ses
      .setActiveReceiptRuleSet({
        RuleSetName: this.emailReceiptRuleSetName
      })
      .promise()
      .catch((error) => {
        this.serverless.cli.log('Failed to set active SES Receipt RuleSet');
        throw error;
      });

    this.serverless.cli.log(
      `Sending a verifying request to each of the following email addresses: ${recipients.join(', ')} ...`
    );

    // Allow time for SES configuration and DNS changes to be applied before sending verification request...
    await delay(this.delayEmailVerificationMs);

    await Promise.all(
      recipients.map(async (recipientEmailAddress) => {
        await this.ses
          .verifyEmailIdentity({
            EmailAddress: recipientEmailAddress
          })
          .promise();
      })
    ).catch((error) => {
      this.serverless.cli.log('Failed to send email verification request for one or more recipients');
      throw error;
    });
  }
}
