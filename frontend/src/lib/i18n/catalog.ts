/**
 * Locale catalog scaffolding (#549).
 *
 * Starts scoped to wallet-connection strings (the flow named in the issue) as
 * the first slice moved onto the catalog; other areas of the app migrate onto
 * this same pattern incrementally rather than all at once.
 */

export const en = {
  "wallet.connect": "Connect",
  "wallet.connecting": "Connecting…",
  "wallet.disconnect": "Disconnect",
  "wallet.menu.privateBalance": "Private balance",
  "wallet.menu.privacyPool": "Privacy pool",
  "wallet.menu.transactionHistory": "Transaction history",
  "wallet.menu.manage": "Manage",
  "wallet.menu.profile": "Profile",
} as const;

export type LocaleKey = keyof typeof en;

export const es: Record<LocaleKey, string> = {
  "wallet.connect": "Conectar",
  "wallet.connecting": "Conectando…",
  "wallet.disconnect": "Desconectar",
  "wallet.menu.privateBalance": "Saldo privado",
  "wallet.menu.privacyPool": "Fondo de privacidad",
  "wallet.menu.transactionHistory": "Historial de transacciones",
  "wallet.menu.manage": "Gestionar",
  "wallet.menu.profile": "Perfil",
};
