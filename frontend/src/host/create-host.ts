import { DemoHostClient } from '@/host/demo-host';
import type { HostClient } from '@/host/types';
import { WebSocketHostClient, type BridgeInfo } from '@/host/ws-host';

interface DesktopBridgeApi {
	bridge_info(): Promise<BridgeInfo>;
}

declare global {
	interface Window {
		pywebview?: {
			api?: DesktopBridgeApi;
		};
		/** Test/dev injection; the desktop app supplies bridge_info through pywebview. */
		__studioBridge?: BridgeInfo;
	}
}

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForDesktopBridge(): Promise<BridgeInfo | undefined> {
	const isDesktop = new URLSearchParams(window.location.search).get('desktop') === '1';
	if (!isDesktop) return undefined;
	const deadline = Date.now() + 15000;
	while (Date.now() < deadline) {
		try {
			const info = await window.pywebview?.api?.bridge_info();
			if (info?.port && info.token) return info;
		} catch {
			// pywebview can inject the API after the document is ready.
		}
		await sleep(120);
	}
	return undefined;
}

export async function createHostClient(): Promise<HostClient> {
	if (window.__studioBridge) return new WebSocketHostClient(window.__studioBridge);
	const bridge = await waitForDesktopBridge();
	if (!bridge) return new DemoHostClient();
	return new WebSocketHostClient(bridge);
}
