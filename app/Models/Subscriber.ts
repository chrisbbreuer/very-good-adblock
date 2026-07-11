import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

export interface SubscriberRow {
  id: number
  email: string
  status: string
  source: string
  uuid: string
  created_at: string
  updated_at: string | null
}

/**
 * The subset of the query-builder surface this app uses. `defineModel` returns a
 * fully usable model at runtime but is typed as void by the published ORM, so we
 * pin an explicit type on the export (also required by isolatedDeclarations).
 */
export interface SubscriberModel {
  table: string
  where: (column: string, value: string) => { first: () => Promise<SubscriberRow | null> }
  create: (data: { email: string, status?: string, source?: string }) => Promise<SubscriberRow>
}

/**
 * Subscriber — newsletter signups from the marketing page's "notify me when it
 * hits the stores" form. Published from the Stacks framework's default model so
 * the app owns it; trimmed to the relations Very Good AdBlock actually uses
 * (no User / campaign graph).
 */
const Subscriber: SubscriberModel = defineModel({
  name: 'Subscriber',
  table: 'subscribers',
  primaryKey: 'id',
  autoIncrement: true,

  traits: {
    useUuid: true,
    useTimestamps: true,
  },

  attributes: {
    email: {
      unique: true,
      required: true,
      fillable: true,
      validation: {
        rule: schema.string().email().max(255),
        message: {
          string: 'email must be a string',
          required: 'email is required',
          email: 'email must be a valid email address',
          max: 'email must have a maximum of 255 characters',
        },
      },
      factory: faker => faker.internet.email(),
    },

    status: {
      required: true,
      fillable: true,
      default: 'subscribed',
      validation: {
        rule: schema.enum(['subscribed', 'unsubscribed', 'pending', 'bounced']),
        message: {
          enum: 'status must be one of: subscribed, unsubscribed, pending, bounced',
        },
      },
      factory: faker => faker.helpers.arrayElement(['subscribed', 'unsubscribed', 'pending']),
    },

    source: {
      required: false,
      fillable: true,
      default: 'homepage',
      validation: {
        rule: schema.string().max(100),
        message: {
          string: 'source must be a string',
          max: 'source must have a maximum of 100 characters',
        },
      },
      factory: faker => faker.helpers.arrayElement(['homepage', 'features', 'landing-page']),
    },
  },
} as const) as unknown as SubscriberModel

export default Subscriber
