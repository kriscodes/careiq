/** Test-only authenticated principal seam. No account or provider traffic. */
declare global { interface Window { __careiqRealApiIdentity: {subject:string;bearer:string;orgId?:string;locationId?:string;practiceName?:string} } }
const getToken=async()=>window.__careiqRealApiIdentity.bearer;
export function useAuth(){return{isLoaded:true,isSignedIn:true,userId:window.__careiqRealApiIdentity.subject,orgId:window.__careiqRealApiIdentity.orgId,getToken};}
export function useUser(){return{isLoaded:true,user:{id:window.__careiqRealApiIdentity.subject,firstName:'Synthetic'}};}
export function UserButton(){return <button type="button">Synthetic test account</button>;}
export function useOrganizationList(){const identity=window.__careiqRealApiIdentity;return{isLoaded:true,setActive:async()=>{throw new Error('UNEXPECTED_FIXTURE_PRACTICE_SWITCH');},userMemberships:{data:identity.orgId?[{id:'synthetic_staff_membership',organization:{id:identity.orgId,name:identity.practiceName}}]:[],isLoading:false,hasNextPage:false,error:null,fetchNext:async()=>{}}};}
export function useClerk(){return{signOut:async()=>{throw new Error('UNEXPECTED_FIXTURE_SIGN_OUT');}};}
export function useReverification<Args extends unknown[],Result>(operation:(...args:Args)=>Promise<Result>){return operation;}
