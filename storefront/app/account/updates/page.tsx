import { Announcements } from '@/components/announcements';
export const metadata = { title: 'Store updates' };
export default function Page() {
  return (
    <div className="shell page">
      <Announcements />
    </div>
  );
}
