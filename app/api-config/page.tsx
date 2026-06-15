// Task A3 — API config page (Meta tokens + Google Drive connection).
import V2MediaLabLayout from '../components/V2MediaLabLayout';
import ApiTokenForm from './components/ApiTokenForm';
import GoogleDrivePanel from './components/GoogleDrivePanel';

export default function ApiConfigPage() {
  return (
    <V2MediaLabLayout title="Configurações de Integração">
      <div className="max-w-4xl flex flex-col gap-8">
        <ApiTokenForm />
        <GoogleDrivePanel />
      </div>
    </V2MediaLabLayout>
  );
}
