import type {QueryClient} from './transaction.js';
import {id} from './policy.js';

/** Server clock and validated location scope are enforced by the database; no caller date is accepted. */
export async function patientAdultSelfEligible(client:QueryClient,patientId:string):Promise<boolean> {
    return (await client.query('SELECT careiq_patient_adult_self_eligible($1) AS eligible',[id(patientId)])).rows[0]?.eligible===true;
}
