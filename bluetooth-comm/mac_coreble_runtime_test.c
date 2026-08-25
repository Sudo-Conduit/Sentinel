// mac_coreble_runtime_test.c
// Target: macOS, compiled as plain C (NOT Objective-C).
// Compile: clang -framework CoreBluetooth -framework Foundation -lobjc \
//              -o coreble_test mac_coreble_runtime_test.c
//
// Proof-of-concept: drive CBPeripheralManager (Apple's BLE peripheral/
// advertising API) with zero Objective-C syntax, by calling straight into
// the Objective-C runtime (libobjc) from C. CoreBluetooth ships no C header
// — this file builds one class, one delegate method, and every message
// send by hand: objc_getClass()/sel_registerName() to look things up,
// objc_msgSend() to call them, class_addMethod()/objc_allocateClassPair()
// to build a delegate class at runtime with a plain C function as its
// implementation.
//
// This is the "why would anyone do this" route. The practical version of
// the same goal is a five-line Objective-C delegate in a .m file — this
// file exists to prove the C-only path actually works, not because it's
// a good way to maintain this long-term.
//
// KNOWN CAVEAT: run as a bare, unsigned command-line binary, macOS's
// privacy layer (TCC) may refuse to grant Bluetooth peripheral access at
// all — CBPeripheralManager's state will sit at CBManagerStateUnauthorized
// and never reach PoweredOn. If that happens, the practical fix is wrapping
// this binary in a minimal .app bundle with an Info.plist declaring
// NSBluetoothAlwaysUsageDescription, so macOS has somewhere to attach the
// permission prompt. Flagging this now so it isn't mistaken for a bug in
// the runtime-calling code below.

#include <stdio.h>
#include <dispatch/dispatch.h>
#include <objc/objc.h>
#include <objc/runtime.h>
#include <objc/message.h>

// CoreBluetooth exports these as plain C-linkage NSString* constants — no
// Objective-C header needed to reference them, just an extern declaration
// and linking against the framework.
extern id CBAdvertisementDataLocalNameKey;

// ---- objc_msgSend needs a distinct cast per call signature ----
// The real objc_msgSend is untyped/variadic; on both x86_64 and arm64 you
// must cast it to a function pointer matching the actual argument and
// return types of whatever method you're calling, or the calling
// convention breaks.
typedef id      (*msgsend_id_t)(id, SEL);
typedef id      (*msgsend_id_id_id_t)(id, SEL, id, id);
typedef id      (*msgsend_id_id_id_id_t)(id, SEL, id, id, id);
typedef id      (*msgsend_id_cstr_t)(id, SEL, const char *);
typedef long    (*msgsend_long_t)(id, SEL);
typedef void    (*msgsend_void_id_t)(id, SEL, id);
typedef const char *(*msgsend_cstr_t)(id, SEL);

static id cls(const char *name) { return (id)objc_getClass(name); }
static SEL sel(const char *name) { return sel_registerName(name); }

// ---- Delegate method implementation: -peripheralManagerDidUpdateState: ----
// This is the one required CBPeripheralManagerDelegate method. We register
// it as a plain C function via class_addMethod below; the ObjC runtime
// calls it exactly like any other method IMP.
static void delegate_did_update_state(id self, SEL _cmd, id peripheral) {
    (void)self;
    (void)_cmd;

    long state = ((msgsend_long_t)objc_msgSend)(peripheral, sel("state"));

    // CBManagerState: Unknown=0, Resetting=1, Unsupported=2,
    // Unauthorized=3, PoweredOff=4, PoweredOn=5.
    const char *labels[] = {
        "unknown", "resetting", "unsupported", "unauthorized", "poweredOff", "poweredOn"
    };
    const char *label = (state >= 0 && state <= 5) ? labels[state] : "?";
    printf("[CoreBLE/C] peripheral manager state -> %s (%ld)\n", label, state);

    if (state != 5 /* CBManagerStatePoweredOn */) {
        if (state == 3) {
            printf("[CoreBLE/C] unauthorized — this binary likely needs an Info.plist\n"
                   "            with NSBluetoothAlwaysUsageDescription (see file header).\n");
        }
        return;
    }

    // Build the advertisement dictionary:
    //   { CBAdvertisementDataLocalNameKey: @"Sentinel-Mac" }
    id name = ((msgsend_id_cstr_t)objc_msgSend)(cls("NSString"), sel("stringWithUTF8String:"), "Sentinel-Mac");

    id dict = ((msgsend_id_t)objc_msgSend)(cls("NSMutableDictionary"), sel("dictionary"));
    ((msgsend_id_id_id_t)objc_msgSend)(dict, sel("setObject:forKey:"), name, CBAdvertisementDataLocalNameKey);

    ((msgsend_void_id_t)objc_msgSend)(peripheral, sel("startAdvertising:"), dict);
    printf("[CoreBLE/C] startAdvertising: called — waiting for didStartAdvertisingError:\n"
           "            to confirm whether the OS actually accepted it.\n");
}

// ---- Delegate method implementation:
//      -peripheralManager:didStartAdvertisingError: ----
// startAdvertising: is fire-and-forget; this is the only way to learn
// whether the OS actually turned the radio on or silently refused.
static void delegate_did_start_advertising(id self, SEL _cmd, id peripheral, id error) {
    (void)self;
    (void)_cmd;
    (void)peripheral;

    if (error == (id)NULL) {
        printf("[CoreBLE/C] didStartAdvertisingError: none — OS confirms advertising is live.\n"
               "            This Mac should now be visible as \"Sentinel-Mac\" to any\n"
               "            nearby BLE scanner (nRF Connect, etc).\n");
        return;
    }

    id desc = ((msgsend_id_t)objc_msgSend)(error, sel("localizedDescription"));
    const char *desc_cstr = ((msgsend_cstr_t)objc_msgSend)(desc, sel("UTF8String"));
    printf("[CoreBLE/C] didStartAdvertisingError: %s\n", desc_cstr ? desc_cstr : "(no description)");
}

int main(void) {
    // 1. Build a delegate class at runtime: a bare NSObject subclass with
    //    one method, -peripheralManagerDidUpdateState:, implemented by the
    //    C function above.
    Class delegate_class = objc_allocateClassPair((Class)cls("NSObject"), "MinimalCBDelegate", 0);
    if (!delegate_class) {
        fprintf(stderr, "objc_allocateClassPair failed (class already registered?)\n");
        return 1;
    }

    // Type encoding "v@:@" = void return, (self, _cmd, id argument).
    BOOL added = class_addMethod(delegate_class, sel("peripheralManagerDidUpdateState:"),
                                  (IMP)delegate_did_update_state, "v@:@");
    // "v@:@@" = void return, (self, _cmd, id peripheral, id error).
    // NB: the real selector is peripheralManagerDidStartAdvertising:error:
    // - registering the wrong name means the method is never called, which
    // silently hides advertising failures.
    BOOL added2 = class_addMethod(delegate_class, sel("peripheralManagerDidStartAdvertising:error:"),
                                   (IMP)delegate_did_start_advertising, "v@:@@");
    if (!added || !added2) {
        fprintf(stderr, "class_addMethod failed\n");
        return 1;
    }

    Protocol *proto = objc_getProtocol("CBPeripheralManagerDelegate");
    if (proto) {
        class_addProtocol(delegate_class, proto);
    }

    objc_registerClassPair(delegate_class);

    // 2. Instantiate the delegate: [[MinimalCBDelegate alloc] init]
    id delegate_alloc = ((msgsend_id_t)objc_msgSend)((id)delegate_class, sel("alloc"));
    id delegate_instance = ((msgsend_id_t)objc_msgSend)(delegate_alloc, sel("init"));

    // 3. Instantiate the peripheral manager:
    //    [[CBPeripheralManager alloc] initWithDelegate:queue:options:]
    //    queue = nil -> delegate callbacks land on the main dispatch queue,
    //    which is why main() ends by pumping it with dispatch_main().
    id mgr_alloc = ((msgsend_id_t)objc_msgSend)(cls("CBPeripheralManager"), sel("alloc"));
    id mgr = ((msgsend_id_id_id_id_t)objc_msgSend)(mgr_alloc, sel("initWithDelegate:queue:options:"),
                                                    delegate_instance, (id)NULL, (id)NULL);
    (void)mgr;

    printf("[CoreBLE/C] CBPeripheralManager created via pure-C objc_msgSend calls.\n"
           "            Waiting for state callbacks (needs the main dispatch queue running)...\n");

    dispatch_main(); // never returns; pumps the main queue so delegate callbacks fire
    return 0;
}
