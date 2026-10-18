import {createRoot} from 'react-dom/client';
import {I18nProvider} from '../../../src/i18n/provider';
import {PatientWorkflow} from '../../../src/components/workflow/PatientWorkflow';
import {PatientPaperworkLibrary} from '../../../src/components/workflow/PatientPaperworkLibrary';
createRoot(document.getElementById('root')!).render(<I18nProvider scope="patient">{location.pathname==='/patient-paperwork'?<PatientPaperworkLibrary/>:<PatientWorkflow/>}</I18nProvider>);
