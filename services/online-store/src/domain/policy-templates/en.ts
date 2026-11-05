/**
 * Starting text for the five store policies (spec 2.3), in English. Placeholders are filled by
 * `renderPolicyTemplate`; merchant values are escaped there, and a merchant value never starts a
 * line or sits next to another placeholder at the start of one (Ruling 21).
 */
export const SENTENCES = {
  or: " or ",
  throughStore: "our store",
  returnShipping: {
    customer:
      "The customer pays the cost of return shipping, unless the item arrived defective or is not what was ordered.",
    store: "We pay the cost of return shipping.",
  },
  refundMethod: {
    original: "Approved refunds are paid back to the original payment method.",
    store_credit: "Approved refunds are given as store credit you can use on your next order.",
    cash: "For cash on delivery orders, approved refunds are paid in cash or by bank or wallet transfer.",
  },
  cod: {
    yes: "You can pay in cash when your order is delivered.",
    no: "Orders are paid online at checkout.",
  },
  international: {
    yes: "We also ship outside the country. Delivery times and costs for international orders are shown at checkout.",
    no: "We currently ship within the country only.",
  },
} as const;

export const TEMPLATES = {
  refund: `## Returns

You can return an item within {returnWindowDays} days of delivery. It must be unused, in its original packaging, with proof of purchase.

## How to request a return

Contact us at {contact} with your order number and the reason for the return.

## Return shipping

{returnShipping}

## Refunds

Once we receive and inspect the item, we will tell you whether your refund is approved. {refundMethod}

## Items that cannot be returned

- Items that were used, damaged after delivery, or are missing parts.
- Personalised or made-to-order items, unless they arrived defective.

## Defective or wrong items

If your item arrived defective or is not what you ordered, contact us within {returnWindowDays} days of delivery and we will replace or refund it at no cost to you.`,
  shipping: `## Delivery times

We deliver within {deliveryMin} to {deliveryMax} business days after your order is confirmed.

## Shipping costs

Shipping costs are calculated at checkout and shown before you pay.

## Paying on delivery

{cod}

## Shipping outside the country

{international}

## Questions

For any question about your delivery, contact us at {contact}.`,
  privacy: `## What we collect

When you order from {storeName}, we collect your name, phone number, email address, delivery address and order details.

## How we use it

We use your information to process and deliver your orders, to contact you about them, and to improve our store. We do not sell your personal information.

## Who we share it with

We share only what is needed with the delivery companies and payment providers that complete your order.

## Your choices

You can ask us to see, correct or delete your information by contacting us at {contact}.`,
  terms: `## About these terms

These terms apply to every purchase from {storeName}. By placing an order you agree to them.

## Orders and prices

Prices are shown in the store's currency. We may cancel an order if an item is out of stock or a price was shown in error, and we will refund anything you paid.

## Delivery, returns and refunds

Delivery is covered by our shipping policy, and returns and refunds by our refund policy.

## Contact

For any question about these terms, contact us at {contact}.`,
  contact: `## Contact {storeName}

- Address: {address}
- Email: {email}
- Phone / WhatsApp: {phone}`,
} as const;
