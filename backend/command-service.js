/** Backend adapter contract, not a deployed server. No browser imports allowed.
 * authenticate must verify sessions against the auth provider, not decode untrusted JWTs.
 * repository.transact must provide serializable atomic updates and durable persistence.
 */
import { createHash, randomBytes } from 'node:crypto';
import { applyCommand, createSpace } from '../couples.js';
const hash = token => createHash('sha256').update(token).digest('hex');
const publicState = state => { const copy=structuredClone(state); copy.invite=copy.invite?{invitee:copy.invite.invitee,expires:copy.invite.expires}:null;return copy; };
export function createCommandService({authenticate,repository,today}) {
 if(typeof authenticate!=='function'||!repository?.transact||!repository?.create||!repository?.read||typeof today!=='function')throw new Error('Verified auth, transactional repository and server clock required');
 const identity=async session=>{const u=await authenticate(session);if(!u?.id||u.anonymous===true||u.emailVerified!==true)throw new Error('Unauthenticated');return u.id;};
 return {
  async create(session,{id,name}) {const actor=await identity(session);return publicState(await repository.create(createSpace({id,owner:actor,name})));},
  async read(session,id){const actor=await identity(session);const s=await repository.read(id);if(!s||!s.members.includes(actor))throw new Error('Not found');return publicState(s);},
  async command(session,id,expectedRevision,command){
   const actor=await identity(session);
   // Actor, membership, timestamps and space ID never come from command payloads.
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('Revision required');
   let invitationToken=null;
   const result=await repository.transact(id,async s=>{
    if(!s)throw new Error('Not found');
    const accepting=command?.type==='acceptInvite' && s.invite?.invitee===actor && typeof command.token==='string' && hash(command.token)===s.invite.token && today()<=s.invite.expires;
    if(!s.members.includes(actor)&&!accepting)throw new Error('Not found');
    if(s.revision!==expectedRevision)throw new Error('Conflict: refresh and confirm latest version');
    const c=structuredClone(command);
    if(c.type==='invite'){invitationToken=randomBytes(32).toString('base64url');c.token=hash(invitationToken);}
    if(c.type==='acceptInvite'){if(typeof c.token!=='string')throw new Error('Invalid invitation');c.token=hash(c.token);}
    return applyCommand(s,actor,c,today());
   });
   return {state:publicState(result),...(invitationToken?{invitationToken}:{})};
  }
 };
}
