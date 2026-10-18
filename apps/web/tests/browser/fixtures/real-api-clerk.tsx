/** Test-only authenticated principal seam. No account or provider traffic. */
declare global { interface Window { __careiqRealApiIdentity: {subject:string;bearer:string} } }
const getToken=async()=>window.__careiqRealApiIdentity.bearer;
export function useAuth(){return{isLoaded:true,isSignedIn:true,userId:window.__careiqRealApiIdentity.subject,getToken};}
export function useUser(){return{isLoaded:true,user:{id:window.__careiqRealApiIdentity.subject}};}
