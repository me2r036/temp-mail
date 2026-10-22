import { DOMAINS_SET } from "@/config/domains";
import { ERR } from "@/utils/http";
import { getDomain } from "@/utils/mail";

/**
 * Check if a domain (or subdomain) is supported
 */
export function isDomainSupported(domain: string): boolean {
	const normalized = (domain || "").toLowerCase().trim();
	if (!normalized) return false;
	for (const d of DOMAINS_SET) {
		const base = d.toLowerCase().trim();
		if (normalized === base || normalized.endsWith(`.${base}`)) {
			return true;
		}
	}
	return false;
}

/**
 * Validate email domain after Zod validation
 * Returns validation result with error if invalid
 */
export function validateEmailDomain(emailAddress: string) {
	const domain = getDomain(emailAddress);
	if (!isDomainSupported(domain)) {
		return {
			valid: false,
			error: ERR("Domain not supported", "DomainError", {
				supported_domains: Array.from(DOMAINS_SET),
			}),
		};
	}
	return { valid: true };
}
