import DopScaleLayout from '../components/DopScaleLayout';
import ApiTokenForm from './components/ApiTokenForm';

export default function ApiConfigPage() {
  return (
    <DopScaleLayout title="Configurações de Integração">
      <div className="max-w-4xl">
        <ApiTokenForm />
      </div>
    </DopScaleLayout>
  );
}
