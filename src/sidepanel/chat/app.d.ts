export function connectorState(): { authenticated: boolean; online: boolean; canCompose: boolean }
export function connectorRpc(operation: string, input?: Record<string, unknown>): Promise<unknown>
export function insertBrowserContext(text: string): Promise<void>
