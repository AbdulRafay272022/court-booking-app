// Roman Urdu copy: the SOURCE OF TRUTH for wording (keep the existing text verbatim). Keys start with 'venue.' (the namespace).
// Where the page was already English, that English stays here word for word; copy added in Phase 3 is Roman Urdu.
export const ruVenue = {
  // page <title> / description
  "venue.meta.title": "{sports} Courts in {place} — {name}",
  "venue.meta.description": "Book {sports} courts at {name} in {place}, {city} on Khelo. Real-time availability, instant confirmation.",
  "venue.meta.notFound": "Venue not found",

  // navigation
  "venue.back": "Results par wapas",
  "venue.breadcrumb.label": "Breadcrumb",
  "venue.common.close": "Close",

  // venue card (Search and Saved venues) and shared tags
  "venue.card.rated": "Rated ",
  "venue.card.from": "From",
  "venue.card.perSlot": "/ slot",
  "venue.card.priceOnRequest": "Price on request",
  "venue.card.view": "View",
  "venue.card.freeToday": "Aaj khali",
  "venue.card.fewSlots": "Kam slots",
  "venue.card.indoor": "Indoor",
  "venue.card.outdoor": "Outdoor",
  "venue.card.openInMaps": "Maps mein kholein",
  "venue.card.openInMapsFor": "{name} ko Maps mein kholein",

  // venue header and side panel
  "venue.hero.courtOne": "{count} {sports} court",
  "venue.hero.courtMany": "{count} {sports} courts",
  "venue.aside.label": "Venue summary",
  "venue.aside.sports": "Sports",
  "venue.aside.setting": "Setting",
  "venue.aside.location": "Location",
  "venue.aside.check": "Check availability",
  "venue.aside.whatsapp": "Ask on WhatsApp",

  // Location section
  "venue.loc.title": "Location",
  "venue.loc.mapLabel": "{name} ka map",
  "venue.loc.tapToUse": "Map istemal karne ke liye tap karein",
  "venue.loc.lockMap": "Map lock karein",
  "venue.loc.ctrlHint": "Map zoom karne ke liye Ctrl dabaye rakh kar scroll karein.",
  "venue.loc.directions": "Directions",
  "venue.loc.share": "Location share karein",
  "venue.loc.whatsapp": "WhatsApp par bhejein",
  "venue.loc.copy": "Link copy karein",
  "venue.loc.copied": "Copy ho gaya",
  "venue.loc.copyFailed": "Copy nahi ho saka. Dobara koshish karein.",

  // Search map
  "venue.map.label": "Map of venues",
  "venue.map.from": "From PKR {price} / slot",
  "venue.map.view": "View venue →",

  // availability section
  "venue.avail.title": "Availability",
  "venue.avail.noCourts": "No active courts for this sport yet.",
  "venue.avail.minimum": "{duration} minimum",
  "venue.avail.fromPrice": "From PKR {price}",
  "venue.hours.title": "BOOKING HOURS",
  "venue.hours.closed": "CLOSED / UNAVAILABLE",

  // photo gallery
  "venue.gallery.photoOf": "{alt} photo {n} of {count}",
  "venue.gallery.prev": "Previous photo",
  "venue.gallery.next": "Next photo",
  "venue.gallery.thumbs": "Photo thumbnails",
  "venue.gallery.show": "Show photo {n}",

  // reviews
  "venue.reviews.stars": "{value} out of 5 stars",
  "venue.reviews.countOne": "{count} review",
  "venue.reviews.countMany": "{count} reviews",
  "venue.reviews.breakdown": "Rating breakdown",
  "venue.reviews.title": "Reviews",
  "venue.reviews.titleCount": "Reviews ({count})",
  "venue.reviews.none": "No reviews yet",
  "venue.reviews.noneHint": "Played here? You can rate your game from My bookings once it's done.",
  "venue.reviews.player": "Player",
  "venue.reviews.hidden": "HIDDEN",
  "venue.reviews.edited": "edited",
  "venue.reviews.reply": "Reply from the venue",
  "venue.reviews.hide": "Hide",
  "venue.reviews.unhide": "Unhide",
  "venue.reviews.fewer": "Show fewer",
  "venue.reviews.all": "Show all {count} reviews",

  // month calendar
  "venue.cal.weekdays": "M,T,W,T,F,S,S",
  "venue.cal.loading": "Loading…",
  "venue.cal.dayLabel": "{date}, {state}",
  "venue.cal.state.open": "open",
  "venue.cal.state.few": "few",
  "venue.cal.state.full": "full",
  "venue.cal.state.closed": "closed",
  "venue.cal.state.past": "past",
  "venue.cal.state.beyond": "beyond",
  "venue.cal.state.noHours": "no hours set",
  "venue.cal.legend.open": "Open",
  "venue.cal.legend.few": "Filling up",
  "venue.cal.legend.full": "Fully booked",
  "venue.cal.legend.closed": "Closed that day",
  "venue.cal.noHours": "No hours set for this court",
  "venue.cal.noHoursNote": "This court hasn't set its opening hours yet — check back soon or message the venue.",
  "venue.cal.prev": "Previous month",
  "venue.cal.next": "Next month",

  // how long do you want to play
  "venue.sheet.book": "Book {court}",
  "venue.sheet.howLong": "How long do you want to play?",
  "venue.sheet.working": "Working out the price…",
  "venue.sheet.total": "Total for {duration}",
  "venue.sheet.advance": "Pay PKR {advance} now to hold it; PKR {balance} at the venue.",
  "venue.sheet.payNow": "You pay this now to hold the court.",
  "venue.sheet.continue": "Continue",

  // day popup
  "venue.pop.today": "Today",
  "venue.pop.tomorrow": "Tmrw",
  "venue.pop.availability": "{court} availability",
  "venue.pop.backToMonth": "Back to month view",
  "venue.pop.noMoreToday": "No more times left today.",
  "venue.pop.closedDay": "Closed this day.",
  "venue.pop.afterMidnight": "AFTER MIDNIGHT",
  "venue.pop.paymentPending": "Payment pending",
  "venue.pop.paymentPendingCaps": "PAYMENT PENDING",
  "venue.pop.yourBooking": "YOUR BOOKING",
  "venue.pop.booked": "Booked",
  "venue.pop.unavailable": "Unavailable",
  "venue.pop.needsAtLeast": "Needs at least {duration} free",
  "venue.pop.onWaitlist": "On waitlist",
  "venue.pop.notifyMe": "Notify me",
  "venue.pop.open": "Open",
  "venue.pop.tooShort": "Too short",
  "venue.pop.waitlistJoined": "You're on the list — we'll let you know if this slot opens up. You're #{position} in line.",
  "venue.pop.waitlistFailed": "Couldn't join the waitlist: {error}",
} as const;
