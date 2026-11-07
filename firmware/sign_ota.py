# PlatformIO extra script (#134): signs firmware.bin for OTA (secure boot v2 signature block, RSA-3072) without
# secure boot. A running pod trusts the key its own image was signed with (CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT),
# so every image of a set, and every update, must be signed with the same key. No eFuse is touched.
# Key: file named by env OTA_SIGNING_KEY_FILE (release: CI writes the secret OTA_SIGNING_KEY there), else the
# git-ignored firmware/ota_test_key.pem, created on first build. Developer builds therefore only update from developer builds.
import os, subprocess, sys
Import("env")

ESPSECURE = os.path.join(env.PioPlatform().get_package_dir("tool-esptoolpy"), "espsecure.py")
KEY = os.environ.get("OTA_SIGNING_KEY_FILE") or os.path.join(env["PROJECT_DIR"], "ota_test_key.pem")

def sign(source, target, env):
    py = env.subst("$PYTHONEXE")
    if subprocess.call([py, "-c", "import cryptography, ecdsa"]) != 0:    # espsecure.py needs them; the PlatformIO python lacks them
        subprocess.check_call([py, "-m", "pip", "install", "cryptography", "ecdsa"])
    if not os.path.exists(KEY):
        if os.environ.get("OTA_SIGNING_KEY_FILE"):
            sys.exit("OTA_SIGNING_KEY_FILE %s does not exist" % KEY)
        print("sign_ota: creating test key %s (local, not committed)" % KEY)
        subprocess.check_call([py, ESPSECURE, "generate_signing_key", "--version", "2", "--scheme", "rsa3072", KEY])
    image = str(target[0])
    signed = image + ".signed"
    subprocess.check_call([py, ESPSECURE, "sign_data", "--version", "2", "--keyfile", KEY, "--output", signed, image])
    subprocess.check_call([py, ESPSECURE, "verify_signature", "--version", "2", "--keyfile", KEY, signed])
    os.replace(signed, image)
    print("sign_ota: %s signed with %s (%d bytes)" % (image, KEY, os.path.getsize(image)))

env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", sign)
