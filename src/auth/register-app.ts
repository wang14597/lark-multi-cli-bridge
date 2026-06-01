// SPDX-License-Identifier: MIT
import { registerApp } from '@larksuiteoapi/node-sdk';
import qrcode from 'qrcode-terminal';

export interface RegisteredApp {
  appId: string;
  appSecret: string;
  tenant: 'lark' | 'feishu';
  ownerOpenId?: string;
}

export async function scanRegisterApp(): Promise<RegisteredApp> {
  console.log('\nStarting Lark scan-to-create flow...');
  const result = await registerApp({
    source: 'lark-multi-cli-bridge',
    onQRCodeReady: (info: { url: string; expireIn: number }) => {
      console.log('\nScan this QR code with the Lark mobile app to create a new internal-use application:\n');
      qrcode.generate(info.url, { small: true });
      const mins = Math.max(1, Math.round(info.expireIn / 60));
      console.log(`\nQR code expires in about ${mins} minute(s).`);
      console.log(`You can also open this URL directly: ${info.url}\n`);
    },
    onStatusChange: (info: { status: string }) => {
      if (info.status === 'domain_switched') {
        console.log('Detected international tenant; switched to larksuite.com.');
      } else if (info.status === 'slow_down') {
        console.log('Polling slowed down per server request.');
      }
    },
  });

  const sdkResult = result as unknown as {
    client_id: string;
    client_secret: string;
    user_info?: { tenant_brand?: 'lark' | 'feishu'; open_id?: string };
  };

  return {
    appId: sdkResult.client_id,
    appSecret: sdkResult.client_secret,
    tenant: sdkResult.user_info?.tenant_brand ?? 'lark',
    ...(sdkResult.user_info?.open_id ? { ownerOpenId: sdkResult.user_info.open_id } : {}),
  };
}
