import V2MediaLabLayout from '../components/V2MediaLabLayout';

export const dynamic = 'force-dynamic';

export default function DataStudioPage() {
  return (
    <V2MediaLabLayout title="Data Studio">
      <div className="w-full h-[calc(100vh-9rem)] bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden dark:bg-gray-900 dark:border-gray-700">
        <iframe
          width="600"
          height="450"
          src="https://datastudio.google.com/embed/reporting/60c39bd4-4515-498d-942c-3e5a978ed392/page/CKHpF"
          frameBorder="0"
          style={{ border: 0, width: '100%', height: '100%' }}
          allowFullScreen
          sandbox="allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    </V2MediaLabLayout>
  );
}
