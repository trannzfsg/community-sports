export function shouldRemoveRegistrationForInactivatedPlayer(input: {
  eventDate: string;
  today: string;
}) {
  return input.eventDate >= input.today;
}
