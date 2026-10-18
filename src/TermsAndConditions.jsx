import { Mail, Phone } from 'lucide-react';
import { SUPPORT_EMAIL, SUPPORT_PHONE } from './businessInfo';

const sections = [
  {
    title: 'Product information and availability',
    body: 'We aim to keep product descriptions, photos, prices and stock information current. Stock can change, so an item is not reserved until Wen Appliances confirms the order. If a material detail changes, contact us before completing the purchase.'
  },
  {
    title: 'Orders and payment',
    body: 'Checkout collects the contact and fulfillment details needed to process an order. Choose from the payment methods shown at checkout. Keep your order reference for follow-up and contact support if you believe your order details are incorrect.'
  },
  {
    title: 'Delivery and door pickup',
    body: 'Delivery is offered, and door pickup is arranged with our team. Please confirm availability, timing and any applicable delivery or pickup details with support before relying on a specific arrangement.'
  },
  {
    title: 'Warranty and product condition',
    body: 'Product pages and order materials may state a three-month warranty. Ask Wen Appliances to confirm the coverage and any exclusions for the specific item before purchase. Do not rely on this summary as a substitute for the warranty terms provided for that product.'
  },
  {
    title: 'Cancellations, returns and refunds',
    body: 'The website does not currently publish a store-specific return window or refund procedure. Contact us before purchase if you need those details, and contact us promptly if you need to change or cancel an order. Any rights that apply under consumer-protection law remain unaffected.'
  },
  {
    title: 'Using this website',
    body: 'Use the website lawfully and do not attempt to disrupt the service, access another person’s account or submit information that you are not authorized to share. Product questions can be sent through the product chat or the support contact details below.'
  },
  {
    title: 'Information you provide',
    body: 'When you place an order or contact support, provide accurate contact and delivery information. We use those details to respond to you and handle your order. Do not send card numbers, passwords or other secret credentials through chat or contact forms.'
  },
  {
    title: 'Changes to these terms',
    body: 'We may update this page as our services and policies change. The version shown here applies from the date indicated above. If you have questions about a current order, contact us directly.'
  }
];

export default function TermsAndConditions() {
  return (
    <main className="store-policy-page mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <header className="mb-8 border-b pb-6">
        <p className="store-eyebrow text-xs font-semibold uppercase tracking-[0.12em]">Wen Appliances</p>
        <h1 className="store-section-title mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Terms and conditions</h1>
        <p className="store-muted mt-3 text-sm">Last updated: October 18, 2026</p>
      </header>

      <aside className="store-terms-review mb-8 rounded-xl p-4 text-sm leading-6" role="note">
        <strong>General draft for review.</strong> The store has not provided a governing location or complete return, refund and warranty rules. Please have these terms reviewed for the regions where Wen Appliances sells before treating them as a final legal policy.
      </aside>

      <div className="store-policy-content space-y-7">
        <p className="store-muted leading-7">
          These terms summarize how to use the Wen Appliances website and place an order. They are written in plain language and do not replace any mandatory rights or protections that apply where you live.
        </p>
        {sections.map((section) => (
          <section key={section.title} className="store-policy-section border-b pb-6">
            <h2 className="store-section-title text-lg font-semibold">{section.title}</h2>
            <p className="store-muted mt-2 leading-7">{section.body}</p>
          </section>
        ))}
      </div>

      <section className="store-policy-contact mt-8 rounded-xl p-5" aria-labelledby="terms-contact-title">
        <h2 id="terms-contact-title" className="store-section-title text-lg font-semibold">Questions about these terms?</h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:gap-6">
          <a className="store-text-link inline-flex min-h-11 items-center gap-2 text-sm font-medium" href={`mailto:${SUPPORT_EMAIL}`}>
            <Mail className="h-4 w-4" aria-hidden="true" /> {SUPPORT_EMAIL}
          </a>
          <a className="store-text-link inline-flex min-h-11 items-center gap-2 text-sm font-medium" href={`tel:${SUPPORT_PHONE.replace(/[^+\d]/g, '')}`}>
            <Phone className="h-4 w-4" aria-hidden="true" /> {SUPPORT_PHONE}
          </a>
        </div>
      </section>
    </main>
  );
}
