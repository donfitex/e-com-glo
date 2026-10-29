import { ContactForm } from '@/components/contact-form';
export const metadata = { title: 'Contact us' };
export default function Page() {
  return (
    <div className="shell page">
      <ContactForm />
    </div>
  );
}
