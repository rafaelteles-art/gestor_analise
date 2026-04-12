import V2MediaLabLayout from '../components/V2MediaLabLayout';
import ApiTokenForm from './components/ApiTokenForm';

export default function ApiConfigPage() {
  return (
    <V2MediaLabLayout title="Configurações de Integração">
      <div className="max-w-4xl">
        <ApiTokenForm />
      </div>
    </V2MediaLabLayout>
  );
}
