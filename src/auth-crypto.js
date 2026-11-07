import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
export function createAuthCipher(key, sessionId, BufferJSON) {
  const aad = (kind, id) => Buffer.from(JSON.stringify(['nandhana-auth', 1, sessionId, kind, id]));
  return {
    encrypt(value, kind, id) {
      const plaintext = Buffer.from(JSON.stringify(value, BufferJSON.replacer));
      if (plaintext.length > 1048576) throw new Error('AUTH_RECORD_TOO_LARGE');
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad(kind, id));
      const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
    },
    decrypt(envelope, kind, id) {
      try {
        if (envelope?.v !== 1 || typeof envelope.data !== 'string' || envelope.data.length > 1500000) throw new Error();
        const iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
        if (iv.length !== 12 || tag.length !== 16) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(aad(kind, id)); decipher.setAuthTag(tag);
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')), decipher.final()]).toString('utf8'), BufferJSON.reviver);
      } catch { throw new Error('AUTH_DECRYPT_FAILED'); }
    }
  };
}
