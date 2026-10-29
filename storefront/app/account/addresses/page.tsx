import { AddressBook } from '@/components/address-book';
export const metadata = { title: 'Delivery addresses' };
export default function Page() {
  return (
    <div className="shell page">
      <AddressBook />
    </div>
  );
}
