import { createECDH } from 'node:crypto';
export interface BusinessPushConfig { publicKey:string; privateKey:string; subject:string }
export function parseBusinessPushConfig(env:Readonly<Record<string,string|undefined>>):{ok:true;config:BusinessPushConfig|undefined}|{ok:false;invalid:string[]} {
  const names=['BUSINESS_PUSH_PUBLIC_KEY','BUSINESS_PUSH_PRIVATE_KEY','BUSINESS_PUSH_SUBJECT'] as const;
  if(names.every(n=>!env[n]))return {ok:true,config:undefined};
  const publicKey=env.BUSINESS_PUSH_PUBLIC_KEY??'';const privateKey=env.BUSINESS_PUSH_PRIVATE_KEY??'';const subject=env.BUSINESS_PUSH_SUBJECT??'';
  const invalid:string[]=[];
  try {
    const ecdh=createECDH('prime256v1');ecdh.setPrivateKey(Buffer.from(privateKey,'base64url'));
    if(ecdh.getPublicKey().toString('base64url')!==publicKey)invalid.push(names[0],names[1]);
  }catch{invalid.push(names[0],names[1]);}
  if(!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject))invalid.push(names[2]);
  return invalid.length?{ok:false,invalid}:{ok:true,config:{publicKey,privateKey,subject}};
}
