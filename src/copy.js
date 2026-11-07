export function copy(name, kind) {
  const texts = {
    consent: `Hi! I'm ${name}, a Pinterest downloader bot 😊 .start to opt in. Public Pin links are sent to Pinterest; returned media is uploaded to WhatsApp. Only download media you own or have permission to use.\nഞാൻ ${name}, Pinterest ഡൗൺലോഡർ ബോട്ടാണ്. തുടങ്ങാൻ .start അയയ്ക്കൂ.`,
    help: `${name} 😊 Send one public https://www.pinterest.com/pin/<id>/ or https://pin.it/<code> URL after .start.\nഒരു പൊതു Pinterest Pin ലിങ്ക് അയയ്ക്കൂ.\n.help — സഹായം; .reset — consent reset; .stop — നിർത്തുക. Images or direct MP4 only; not every Pin works.`,
    start: 'Ready 😊 Send one public Pin URL. .stop to opt out.\nതയ്യാർ! ഒരു പൊതു Pin ലിങ്ക് അയയ്ക്കൂ.',
    reset: 'Consent reset / സമ്മതം പുനഃസജ്ജമാക്കി. .start to opt in again. No downloads are kept after processing.',
    stop: 'Downloads stopped / ഡൗൺലോഡ് നിർത്തി. .start to opt in again.',
    error: 'Could not safely download this public Pin. It may be restricted, unsupported, unavailable, too large, or timed out. No thumbnail was substituted for video.\nഈ Pin സുരക്ഷിതമായി ഡൗൺലോഡ് ചെയ്യാനായില്ല. മറ്റൊരു പൊതു Pin ശ്രമിക്കൂ.',
    invalid: 'Please send just one HTTPS Pinterest Pin link, not a board or other website.\nഒരു Pinterest Pin ലിങ്ക് മാത്രം അയയ്ക്കൂ.',
    caption: `Downloaded by ${name} • Only reuse with permission. / അനുമതിയോടെ മാത്രം ഉപയോഗിക്കുക.`
  };
  return texts[kind];
}
