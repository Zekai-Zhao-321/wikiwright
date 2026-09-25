// v2 contracts §5, §6: the page interface's identity, which enters the law
// digest, and the one bound on a page's size. A module of its own so the
// digests can name the interface without importing the builder.

export const PAGE_INTERFACE = "page-interface/1";

/** §6: a page over 1 MiB is `page-too-large`; strings in a rule are bounded by it. */
export const PAGE_BYTES_MAX = 1024 * 1024;
