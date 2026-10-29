import { Conversations } from '@/components/conversations';
export const metadata = { title: 'Your private inbox' };
export default function Page() {
  return (
    <div className="shell page">
      <Conversations />
    </div>
  );
}
