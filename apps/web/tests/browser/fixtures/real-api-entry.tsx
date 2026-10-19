import {createRoot} from 'react-dom/client';
import {I18nProvider} from '../../../src/i18n/provider';
import {PatientWorkflow} from '../../../src/components/workflow/PatientWorkflow';
import {PatientPaperworkLibrary} from '../../../src/components/workflow/PatientPaperworkLibrary';
import {AuthenticatedWorkflow} from '../../../src/components/workflow/AuthenticatedWorkflow';
const staff=location.pathname==='/staff';
const identity=window.__careiqRealApiIdentity;
const denied=()=>{throw new Error('SYNTHETIC_STAFF_ACCESS_LOST');};
createRoot(document.getElementById('root')!).render(<I18nProvider scope={staff?'staff':'patient'}>{staff?<AuthenticatedWorkflow orgId={identity.orgId!} locationId={identity.locationId!} practiceName={identity.practiceName!} onAccessDenied={denied}/>:location.pathname==='/patient-paperwork'?<PatientPaperworkLibrary/>:<PatientWorkflow/>}</I18nProvider>);
