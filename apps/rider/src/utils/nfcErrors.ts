// Turns an NFC failure into a message that tells the rider what is actually
// wrong. Both NFC screens used to say "NFC hardware is not available on this
// device" for EVERY failure -- including a cancelled scan or NFC simply being
// switched off -- so riders with working phones were told to give up.
export async function describeNfcFailure(NfcManager: any): Promise<{ title: string; message: string }> {
    try {
        const supported = await NfcManager.isSupported?.();
        if (supported === false) {
            return { title: 'No NFC on this phone', message: "This phone can't read G-Taxi tags." };
        }
        const enabled = await NfcManager.isEnabled?.();
        if (enabled === false) {
            return { title: 'NFC is turned off', message: 'Turn on NFC in your phone Settings, then try again.' };
        }
    } catch {
        // Fall through to the generic "try again" message.
    }
    return {
        title: "Couldn't read the tag",
        message: 'Hold the back of your phone flat against the tag for a second, then try again.',
    };
}

// Always release the reader, success or failure -- otherwise the next scan can
// fail straight away until the app is restarted.
export async function releaseNfc(NfcManager: any): Promise<void> {
    try {
        await NfcManager.cancelTechnologyRequest();
    } catch {
        // Nothing was held.
    }
}
