import providerManager from "./provider-manager.ts";

/**
 * Built into the Chinese omp build. This is an inline core extension factory,
 * not a user-installed extension: /gateway is always available and its
 * providers are registered before the native /model selector resolves.
 */
export const createGatewayExtension = providerManager;
export { loadGatewayProviders } from "./provider-manager.ts";
export default createGatewayExtension;
