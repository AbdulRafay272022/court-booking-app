// The history page lives at /dashboard/bookings (outside /dashboard/owner) but must sit inside the same owner shell:
// sidebar, venue picker and the owner/staff auth guard. Re-using the owner layout keeps ONE shell.
export { default } from "../owner/layout";
