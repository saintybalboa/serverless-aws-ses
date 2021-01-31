# serverless-aws-ses

Configures AWS SES to enable the sending and receiving of mail from email addresses associated with a custom domain.

## Getting started

### Prerequisites

Requires the following:

- [NodeJS](https://nodejs.org/en/download/)
- [NPM](https://www.npmjs.com/get-npm?utm_source=house&utm_medium=homepage&utm_campaign=free%20orgs&utm_term=Install%20npm)
- [Serverless](https://serverless.com/framework/docs/providers/aws/guide/installation/)

### Installing

```bash
npm i serverless-aws-ses
```

Update serverless.yml.

Add the plugin:

```yml
plugins:
  - serverless-aws-ses
```

> **Important**: AWS will attempt to send a verification link to each email address you attempt to add to SES. You are required to visit the link in order to active the email address. You won't have access to incoming email at this point, so you'll need to setup an action for incoming email.

The example below defines an action to use an existing SNS Topic setup to forward incoming email to an active email address.

Add the plugin configuration:

```yml
custom:
  sesConfig:
    domain: foo.com
    hostedZoneId: XXXXXXXX
    emailSenderAliases:
      - 'no-reply'
      - 'admin'
      - 'info'
    emailReceiptRuleActions:
      - SNSAction:
          TopicArn: arn:aws:sns:us-east-1:000000000:EmailForwarder
          Encoding: UTF-8
```

#### Plugin configuration options

| Option                   | Default value | Description   |
| :----------------------- | :------------ | :------------ |
| domain                   |               | The domain of which to add custom email addresses to SES. |
| hostedZoneId             |               | Route53 Hosted Zone ID of specified domain. |
| emailSenderAliases       |               | A list of aliases available to allow SES to send email from. |
| emailReceiptRuleActions  |               | A list of actions for receiving email. Please see the [AWS developer guide](https://docs.aws.amazon.com/ses/latest/DeveloperGuide/receiving-email-action.html) and the [AWS SDK](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/SES.html#createReceiptRule-property) for a list of available actions and the associated implementation details. |
| delayEmailVerificationMs | 30000 (ms)    | The plugin needs to allow time for the DNS records to be created before sending an email verification request. |

### Usage

Please ensure you have access to incoming email via the receipt rule action you defined in the serverless.yml.

Add email addresses to SES:

```bash
sls add_ses
```

Remove email addresses from SES:

```bash
sls remove_ses
```

Deploy stack and add email addresses to SES:

```bash
sls deploy
```

Remove stack and email addresses from SES:

```bash
sls remove
```

