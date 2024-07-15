import fs from 'fs';
import path from 'path';
import { createDataItemSigner } from '@permaweb/aoconnect';

export function getDataItemSigner(walletPath) {
  if (walletPath) {
    const filePath = walletPath.startsWith('/') ? walletPath : path.join(process.cwd(), walletPath);
    const wallet = JSON.parse(fs.readFileSync(filePath, 'utf-8')); // Read wallet from file
    const signer = createDataItemSigner(wallet);
    return signer;
  } else if (!process.env.WALLET_JSON) {
    console.error("Missing wallet. Please provide the wallet JSON in the environment variable WALLET_JSON or specify the file with --wallet.");
    process.exit(1);
  }

  const wallet = JSON.parse(process.env.WALLET_JSON); // Read wallet from environment variable
  const signer = createDataItemSigner(wallet);

  return signer;
}