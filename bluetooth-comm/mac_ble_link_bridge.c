// mac_ble_link_bridge.c
// Target: macOS, compiled as plain C (NOT Objective-C).
// Compile:
//   /usr/bin/clang -isysroot $(xcrun --sdk macosx --show-sdk-path) \
//       -framework CoreBluetooth -framework Foundation -lobjc \
//       -o link_bridge mac_ble_link_bridge.c link_protocol.c
//
// This is mac_coreble_runtime_test.c's advertising proof-of-concept, taken
// the rest of the way: a real GATT peripheral (Nordic UART Service — the
// de facto standard "serial over BLE" profile most BLE tools, including
// nRF Connect, recognize by name) that carries link_protocol.c's actual
// HELLO/OFFER/CHUNK protocol, unmodified, over the air. link_protocol.c
// doesn't know or care that its transport changed from the WASM demo's
// simulated ACL frames to real GATT writes/notifications — it only calls
// two functions, both implemented natively here:
//   - controller_send_acl()   -> CBPeripheralManager updateValue:... (notify)
//   - host_on_link_event()    -> logs to stdout, auto-accepts inbound offers
//
// What this does NOT give you: a full two-sided automatic test. nRF
// Connect is a generic GATT tool — it can subscribe to notifications and
// write raw bytes, but it doesn't speak our HELLO/OFFER/CHUNK wire format,
// so it can't complete a handshake or ack a chunk on its own. This bridge
// still lets you: (a) confirm the GATT transport itself works end to end
// (subscribe, see raw notify bytes; write raw bytes, see them logged here),
// and (b) type a message at this program's stdin to have it offered to
// whatever central is connected, once a real peer capable of running
// link_protocol.c exists on the other end (a Web Bluetooth central in the
// browser artifact would be the natural next piece).
//
// KNOWN LIMITATION: link_protocol.c's chunk size (128 bytes + 5-byte frame
// header = up to 133 bytes) can exceed the default ATT MTU on some
// centrals before MTU negotiation completes. iOS/macOS centrals typically
// negotiate a larger MTU automatically: watch for silently-dropped
// notifications as the symptom if that's not happening in your setup.

#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <dispatch/dispatch.h>
#include <objc/objc.h>
#include <objc/runtime.h>
#include <objc/message.h>

#include "link_protocol.h"

// ---- objc_msgSend casts, one per call signature actually used here ----
typedef id           (*msgsend_id_t)(id, SEL);
typedef id           (*msgsend_id_arg1_t)(id, SEL, id);
typedef id           (*msgsend_id_id_id_t)(id, SEL, id, id);
typedef id           (*msgsend_id_id_id_id_t)(id, SEL, id, id, id);
typedef id           (*msgsend_id_cstr_t)(id, SEL, const char *);
typedef id           (*msgsend_id_ptr_ulong_t)(id, SEL, const void *, unsigned long);
typedef id           (*msgsend_init_char_t)(id, SEL, id, unsigned long, id, unsigned long);
typedef id           (*msgsend_init_svc_t)(id, SEL, id, BOOL);
typedef id           (*msgsend_id_ulong_t)(id, SEL, unsigned long);
typedef long         (*msgsend_long_t)(id, SEL);
typedef unsigned long(*msgsend_ulong_t)(id, SEL);
typedef const void  *(*msgsend_cvoidptr_t)(id, SEL);
typedef void         (*msgsend_void_id_t)(id, SEL, id);
typedef void         (*msgsend_void_id_long_t)(id, SEL, id, long);
typedef BOOL         (*msgsend_bool_3id_t)(id, SEL, id, id, id);

static id cls(const char *name) { return (id)objc_getClass(name); }
static SEL sel(const char *name) { return sel_registerName(name); }

// ---- CoreBluetooth constants (stable public integer values, no runtime
//      lookup needed — only the NSString* key constants require linking) ----
extern id CBAdvertisementDataLocalNameKey;
extern id CBAdvertisementDataServiceUUIDsKey;

#define CB_CHAR_PROP_WRITE_WITHOUT_RESPONSE 0x04
#define CB_CHAR_PROP_WRITE                  0x08
#define CB_CHAR_PROP_NOTIFY                 0x10
#define CB_ATTR_PERM_READABLE                0x01
#define CB_ATTR_PERM_WRITEABLE               0x02

// Nordic UART Service — a de facto standard "serial over BLE" profile;
// reusing its well-known UUIDs means nRF Connect and similar tools label
// this service and its characteristics by name instead of raw UUID.
#define NUS_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_CHAR_UUID  "6E400002-B5A3-F393-E0A9-E50E24DCCA9E" // central writes here
#define NUS_TX_CHAR_UUID  "6E400003-B5A3-F393-E0A9-E50E24DCCA9E" // peripheral notifies here

static id      g_peripheral_mgr = (id)NULL;
static id      g_tx_characteristic = (id)NULL;
static bool    g_central_subscribed = false;

// ---- link_protocol.c's two extern hooks, implemented natively ----

bool controller_send_acl(uint16_t conn_handle, const uint8_t *data, uint16_t len) {
    (void)conn_handle; // no numeric handle in GATT-land; one central at a time here

    if (!g_central_subscribed || g_peripheral_mgr == (id)NULL) {
        return false;
    }

    id value = ((msgsend_id_ptr_ulong_t)objc_msgSend)(cls("NSData"), sel("dataWithBytes:length:"),
                                                        data, (unsigned long)len);
    BOOL ok = ((msgsend_bool_3id_t)objc_msgSend)(g_peripheral_mgr, sel("updateValue:forCharacteristic:onSubscribedCentrals:"),
                                                  value, g_tx_characteristic, (id)NULL);
    return ok ? true : false;
}

void host_on_link_event(uint32_t event_type, uint32_t a, uint32_t b) {
    switch (event_type) {
        case LINK_EVT_HELLO_RECEIVED:
            printf("[Link] handshake complete — ready to offer/receive.\n");
            break;
        case LINK_EVT_OFFER_RECEIVED:
            printf("[Link] incoming offer #%u, %u bytes — auto-accepting.\n", a, b);
            link_offer_respond(true);
            break;
        case LINK_EVT_OFFER_ACCEPTED:
            printf("[Link] peer accepted transfer #%u.\n", a);
            break;
        case LINK_EVT_OFFER_DECLINED:
            printf("[Link] peer declined transfer #%u.\n", a);
            break;
        case LINK_EVT_CHUNK_PROGRESS:
            printf("[Link] transfer #%u progress: %u bytes.\n", a, b);
            break;
        case LINK_EVT_TRANSFER_COMPLETE: {
            printf("[Link] transfer #%u complete (%u bytes).\n", a, b);
            uint32_t rx_len = link_get_rx_length();
            if (rx_len > 0 && rx_len < 4096) {
                uint8_t *rx = link_get_rx_buffer();
                printf("[Link] received: %.*s\n", (int)rx_len, (const char *)rx);
            }
            break;
        }
        case LINK_EVT_ERROR:
            printf("[Link] error code %u\n", a);
            break;
        default:
            break;
    }
}

// ---- CBPeripheralManagerDelegate methods, implemented as plain C functions ----

static void delegate_did_update_state(id self, SEL _cmd, id peripheral) {
    (void)self; (void)_cmd;
    long state = ((msgsend_long_t)objc_msgSend)(peripheral, sel("state"));
    printf("[CoreBLE] state -> %ld\n", state);
    if (state != 5 /* poweredOn */) return;

    // Build RX (write) and TX (notify) characteristics.
    id rx_uuid = ((msgsend_id_arg1_t)objc_msgSend)(cls("CBUUID"), sel("UUIDWithString:"),
                    ((msgsend_id_cstr_t)objc_msgSend)(cls("NSString"), sel("stringWithUTF8String:"), NUS_RX_CHAR_UUID));
    id tx_uuid = ((msgsend_id_arg1_t)objc_msgSend)(cls("CBUUID"), sel("UUIDWithString:"),
                    ((msgsend_id_cstr_t)objc_msgSend)(cls("NSString"), sel("stringWithUTF8String:"), NUS_TX_CHAR_UUID));
    id svc_uuid = ((msgsend_id_arg1_t)objc_msgSend)(cls("CBUUID"), sel("UUIDWithString:"),
                    ((msgsend_id_cstr_t)objc_msgSend)(cls("NSString"), sel("stringWithUTF8String:"), NUS_SERVICE_UUID));

    id rx_char = ((msgsend_id_t)objc_msgSend)(cls("CBMutableCharacteristic"), sel("alloc"));
    rx_char = ((msgsend_init_char_t)objc_msgSend)(rx_char, sel("initWithType:properties:value:permissions:"),
                    rx_uuid, CB_CHAR_PROP_WRITE | CB_CHAR_PROP_WRITE_WITHOUT_RESPONSE,
                    (id)NULL, CB_ATTR_PERM_WRITEABLE);

    id tx_char = ((msgsend_id_t)objc_msgSend)(cls("CBMutableCharacteristic"), sel("alloc"));
    tx_char = ((msgsend_init_char_t)objc_msgSend)(tx_char, sel("initWithType:properties:value:permissions:"),
                    tx_uuid, CB_CHAR_PROP_NOTIFY, (id)NULL, CB_ATTR_PERM_READABLE);
    g_tx_characteristic = tx_char;

    id service = ((msgsend_id_t)objc_msgSend)(cls("CBMutableService"), sel("alloc"));
    service = ((msgsend_init_svc_t)objc_msgSend)(service, sel("initWithType:primary:"), svc_uuid, (BOOL)1);

    // NSArray's arrayWithObjects: is a variadic method - calling a variadic
    // ObjC method through a fixed-arity objc_msgSend cast is unsafe (arm64's
    // calling convention handles variadic args differently, and it segfaults
    // in practice). NSMutableArray + addObject: are ordinary fixed-arity
    // methods, so they're safe through this technique.
    id chars = ((msgsend_id_t)objc_msgSend)(cls("NSMutableArray"), sel("array"));
    ((msgsend_void_id_t)objc_msgSend)(chars, sel("addObject:"), rx_char);
    ((msgsend_void_id_t)objc_msgSend)(chars, sel("addObject:"), tx_char);
    ((msgsend_void_id_t)objc_msgSend)(service, sel("setCharacteristics:"), chars);

    ((msgsend_void_id_t)objc_msgSend)(peripheral, sel("addService:"), service);

    id name = ((msgsend_id_cstr_t)objc_msgSend)(cls("NSString"), sel("stringWithUTF8String:"), "Sentinel-Mac");
    id svc_uuid_array = ((msgsend_id_t)objc_msgSend)(cls("NSMutableArray"), sel("array"));
    ((msgsend_void_id_t)objc_msgSend)(svc_uuid_array, sel("addObject:"), svc_uuid);

    id adv = ((msgsend_id_t)objc_msgSend)(cls("NSMutableDictionary"), sel("dictionary"));
    ((msgsend_id_id_id_t)objc_msgSend)(adv, sel("setObject:forKey:"), name, CBAdvertisementDataLocalNameKey);
    ((msgsend_id_id_id_t)objc_msgSend)(adv, sel("setObject:forKey:"), svc_uuid_array, CBAdvertisementDataServiceUUIDsKey);
    ((msgsend_void_id_t)objc_msgSend)(peripheral, sel("startAdvertising:"), adv);

    printf("[CoreBLE] Nordic UART Service registered, advertising as \"Sentinel-Mac\".\n");
}

static void delegate_did_start_advertising(id self, SEL _cmd, id peripheral, id error) {
    (void)self; (void)_cmd; (void)peripheral;
    if (error == (id)NULL) {
        printf("[CoreBLE] advertising confirmed live.\n");
    } else {
        id desc = ((msgsend_id_t)objc_msgSend)(error, sel("localizedDescription"));
        const char *desc_cstr = ((msgsend_cvoidptr_t)objc_msgSend)(desc, sel("UTF8String"));
        printf("[CoreBLE] didStartAdvertisingError: %s\n", desc_cstr ? desc_cstr : "(no description)");
    }
}

static void delegate_did_subscribe(id self, SEL _cmd, id peripheral, id central, id characteristic) {
    (void)self; (void)_cmd; (void)peripheral; (void)central; (void)characteristic;
    printf("[CoreBLE] central subscribed to TX — starting link handshake.\n");
    g_central_subscribed = true;
    link_on_connected(1); // no real HCI handle in GATT-land; 1 is a placeholder
}

static void delegate_did_unsubscribe(id self, SEL _cmd, id peripheral, id central, id characteristic) {
    (void)self; (void)_cmd; (void)peripheral; (void)central; (void)characteristic;
    printf("[CoreBLE] central unsubscribed — link down.\n");
    g_central_subscribed = false;
    link_on_disconnected();
}

static void delegate_did_receive_write(id self, SEL _cmd, id peripheral, id requests) {
    (void)self; (void)_cmd;

    unsigned long count = ((msgsend_ulong_t)objc_msgSend)(requests, sel("count"));
    for (unsigned long i = 0; i < count; i++) {
        id request = ((msgsend_id_ulong_t)objc_msgSend)(requests, sel("objectAtIndex:"), i);
        id value = ((msgsend_id_t)objc_msgSend)(request, sel("value"));
        const void *bytes = ((msgsend_cvoidptr_t)objc_msgSend)(value, sel("bytes"));
        unsigned long len = ((msgsend_ulong_t)objc_msgSend)(value, sel("length"));

        if (bytes != NULL && len > 0 && len < 4096) {
            link_process_acl_rx((const uint8_t *)bytes, (uint16_t)len);
        }
    }

    if (count > 0) {
        id first = ((msgsend_id_ulong_t)objc_msgSend)(requests, sel("objectAtIndex:"), 0);
        ((msgsend_void_id_long_t)objc_msgSend)(peripheral, sel("respondToRequest:withResult:"), first, 0 /* CBATTErrorSuccess */);
    }
}

static void timer_fired(void *context) {
    (void)context;
    link_pump();
}

// ---- Terminal input: type a line, offer it to whatever's connected ----

static void stdin_readable(void *context) {
    (void)context;
    char line[512];
    if (fgets(line, sizeof(line), stdin) == NULL) return;

    size_t len = strnlen(line, sizeof(line));
    while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) line[--len] = '\0';
    if (len == 0) return;

    if (link_get_state() != LINK_STATE_READY) {
        printf("[Link] not ready yet (need a subscribed, handshaken peer).\n");
        return;
    }

    uint8_t *tx = link_get_tx_buffer();
    memcpy(tx, line, len);

    uint8_t *name_scratch = link_get_offer_name_scratch();
    const char *name = "stdin.txt";
    size_t name_len = strlen(name);
    memcpy(name_scratch, name, name_len);

    bool ok = link_offer_send((uint32_t)len, name_scratch, (uint8_t)name_len, 0);
    printf("[Link] %s offer of %zu bytes.\n", ok ? "sent" : "failed to send", len);
}

int main(void) {
    Class delegate_class = objc_allocateClassPair((Class)cls("NSObject"), "LinkBridgeDelegate", 0);
    if (!delegate_class) { fprintf(stderr, "class already registered\n"); return 1; }

    class_addMethod(delegate_class, sel("peripheralManagerDidUpdateState:"),
                     (IMP)delegate_did_update_state, "v@:@");
    class_addMethod(delegate_class, sel("peripheralManager:didStartAdvertisingError:"),
                     (IMP)delegate_did_start_advertising, "v@:@@");
    class_addMethod(delegate_class, sel("peripheralManager:central:didSubscribeToCharacteristic:"),
                     (IMP)delegate_did_subscribe, "v@:@@@");
    class_addMethod(delegate_class, sel("peripheralManager:central:didUnsubscribeFromCharacteristic:"),
                     (IMP)delegate_did_unsubscribe, "v@:@@@");
    class_addMethod(delegate_class, sel("peripheralManager:didReceiveWriteRequests:"),
                     (IMP)delegate_did_receive_write, "v@:@@");

    Protocol *proto = objc_getProtocol("CBPeripheralManagerDelegate");
    if (proto) class_addProtocol(delegate_class, proto);
    objc_registerClassPair(delegate_class);

    id delegate_instance = ((msgsend_id_t)objc_msgSend)(
        ((msgsend_id_t)objc_msgSend)((id)delegate_class, sel("alloc")), sel("init"));

    id mgr_alloc = ((msgsend_id_t)objc_msgSend)(cls("CBPeripheralManager"), sel("alloc"));
    g_peripheral_mgr = ((msgsend_id_id_id_id_t)objc_msgSend)(mgr_alloc, sel("initWithDelegate:queue:options:"),
                                                              delegate_instance, (id)NULL, (id)NULL);

    link_init();
    link_set_local_name((const uint8_t *)"Sentinel-Mac", 12);

    dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, 0), 50 * NSEC_PER_MSEC, 5 * NSEC_PER_MSEC);
    dispatch_source_set_event_handler_f(timer, timer_fired);
    dispatch_resume(timer);

    dispatch_source_t stdin_src = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, (uintptr_t)STDIN_FILENO, 0, dispatch_get_main_queue());
    dispatch_source_set_event_handler_f(stdin_src, stdin_readable);
    dispatch_resume(stdin_src);

    printf("[Bridge] Sentinel-Mac GATT bridge running. Waiting for a central to subscribe...\n"
           "         Once linked, type a line + Enter to offer it to the connected peer.\n");

    dispatch_main();
    return 0;
}
