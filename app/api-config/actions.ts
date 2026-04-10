'use server'

import { promises as fs } from 'fs';
import path from 'path';

export async function getStoredTokens() {
  let metaProfiles = [];
  try {
    if (process.env.META_PROFILES) {
      metaProfiles = JSON.parse(process.env.META_PROFILES);
    } else if (process.env.META_ACCESS_TOKEN) {
      metaProfiles = [{ name: 'Default', token: process.env.META_ACCESS_TOKEN }];
    }
  } catch(e) {}

  return {
    metaProfiles,
    redtrackKey: process.env.REDTRACK_API_KEY || ''
  };
}

export async function saveApiTokens(metaProfiles: {name: string, token: string}[], redtrackKey: string) {
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    let envContent = '';
    
    try {
      envContent = await fs.readFile(envPath, 'utf8');
    } catch(e) {
      // file doesn't exist, ignore
    }

    const lines = envContent.split('\n');
    let hasProfiles = false;
    let hasRedtrack = false;

    const profilesStr = JSON.stringify(metaProfiles);

    const newLines = lines.map(line => {
      if (line.startsWith('META_PROFILES=')) {
        hasProfiles = true;
        return `META_PROFILES='${profilesStr}'`;
      }
      if (line.startsWith('REDTRACK_API_KEY=')) {
        hasRedtrack = true;
        return `REDTRACK_API_KEY=${redtrackKey}`;
      }
      return line;
    });

    if (!hasProfiles) newLines.push(`META_PROFILES='${profilesStr}'`);
    if (!hasRedtrack) newLines.push(`REDTRACK_API_KEY=${redtrackKey}`);

    await fs.writeFile(envPath, newLines.join('\n'));

    // Update in-memory
    process.env.META_PROFILES = profilesStr;
    process.env.REDTRACK_API_KEY = redtrackKey;
    // Keep backward compat for first token
    if (metaProfiles.length > 0) {
      process.env.META_ACCESS_TOKEN = metaProfiles[0].token;
    }

    return { success: true };
  } catch (err: any) {
    console.error(err);
    return { success: false, error: err.message };
  }
}

