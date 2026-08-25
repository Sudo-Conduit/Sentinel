// mac_ble_link_central.c
// Target: macOS, compiled as plain C (NOT Objective-C).
// Compile:
//   /usr/bin/clang -isysroot $(xcrun --sdk macosx --show-sdk-path) \
//       -framework CoreBluetooth -framework Foundation -lobjc \
//       -o link_central mac_ble_link_central.c link_protocol.c
//
// The other half of mac_ble_link_bridge.c: this is the central role.
// It scans for "Sentinel-Mac", connects, discovers the Nordic UART
// Service, subscribes to TX (notify) and writes to RX — and because it
// links the exact same link_protocol.c, it actually understands the
// HELLO/OFFER/CHUNK protocol on its own. Run this alongside a running
// mac_ble_link_bridge.c (same machine, two processes, one real BLE
// connection between them over the real radio) to get a complete,
// automatic, two-real-peer test of the actual protocol — no manual hex,
// no third-party app standing in for one side.

#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <dispatch/dispatch.h>
#include <objc/objc.h>
#include <objc/runtime.h>
#include <objc/message.h>

#include "link_protocol.h"

typedef id           (*msgsend_id_t)(id, SEL);
typedef id           (*msgsend_id_arg1_t)(id, SEL, id);
typedef id           (*msgsend_id_id_id_id_t)(id, SEL, id, id, id);
typedef id           (*msgsend_id_cstr_t)(id, SEL, const char *);
typedef id           (*msgsend_id_ptr_ulong_t)(id, SEL, const void *, unsigned long);
typedef id           (*msgsend_id_ulong_t)(id, SEL, unsigned long);
typedef long         (*msgsend_long_t)(id, SEL);
typedef unsigned long(*msgsend_ulong_t)(id, SEL);
typedef const void  *(*msgsend_cvoidptr_t)(id, SEL);
typedef void         (*msgsend_void_id_t)(id, SEL, id);
typedef void         (*msgsend_void_t)(id, SEL);
typedef BOOL         (*msgsend_bool_id_arg1_t)(id, SEL, id);

static id cls(const char *name) { return (id)objc_getClass(name); }
static SEL sel(const char *name) { return sel_registerName(name); }

#define NUS_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_CHAR_UUID  "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_TX_CHAR_UUID  "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

static id g_central_mgr = (id)NULL;
static id g_peripheral  = (id)NULL; // the connected Sentinel-Mac CBPeripheral
static id g_rx_char     = (id)NULL; // its RX characteristic (we write here)
static bool g_connected = false;
static Class g_peripheral_delegate_class; // CBPeripheralDelegate, set up in main()

// ---- link_protocol.c's two extern hooks, implemented natively ----

bool controller_send_acl(uint16_t conn_handle, const uint8_t *data, uint16_t len) {
    (void)conn_handle;
    if (!g_connected || g_peripheral == (id)NULL || g_rx_char == (id)NULL) return false;

    id value = ((msgsend_id_ptr_ulong_t)objc_msgSend)(cls("NSData"), sel("dataWithBytes:length:"),
                                                        data, (unsigned long)len);
    // writeValue:forCharacteristic:type: - CBCharacteristicWriteWithoutResponse = 1
    ((void (*)(id, SEL, id, id, long))objc_msgSend)(g_peripheral, sel("writeValue:forCharacteristic:type:"),
                                                     value, g_rx_char, 1);
    return true;
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

// ---- CBCentralManagerDelegate + CBPeripheralDelegate methods ----

static void delegate_did_update_state(id self, SEL _cmd, id central) {
    (void)self; (void)_cmd;
    long state = ((msgsend_long_t)objc_msgSend)(central, sel("state"));
    printf("[CoreBLE] central state -> %ld\n", state);
    if (state != 5 /* poweredOn */) return;

    // Scan for everything rather than filtering by service UUID: a 128-bit
    // custom UUID plus a name can exceed BLE's legacy 31-byte advertising
    // payload, which can make UUID-filtered scanning miss a device that's
    // genuinely advertising. Matching by name in didDiscoverPeripheral: is
    // more robust and is how most real BLE central apps do this anyway.
    ((void (*)(id, SEL, id, id))objc_msgSend)(central, sel("scanForPeripheralsWithServices:options:"), (id)NULL, (id)NULL);
    printf("[CoreBLE] scanning for Sentinel-Mac...\n");
}

static void delegate_did_discover(id self, SEL _cmd, id central, id peripheral, id adv_data, id rssi) {
    (void)self; (void)_cmd; (void)adv_data; (void)rssi;
    if (g_peripheral != (id)NULL) return; // already found one, ignore the rest

    id name = ((msgsend_id_t)objc_msgSend)(peripheral, sel("name"));
    const char *name_cstr = name != (id)NULL ? ((msgsend_cvoidptr_t)objc_msgSend)(name, sel("UTF8String")) : NULL;

    if (name_cstr == NULL) return; // unnamed device, not our target
    printf("[CoreBLE] saw \"%s\"\n", name_cstr);
    if (strcmp(name_cstr, "Sentinel-Mac") != 0) return; // not our target, keep scanning

    printf("[CoreBLE] found Sentinel-Mac — connecting.\n");
    g_peripheral = peripheral;
    // retain across the connection attempt: CoreBluetooth requires the app
    // hold a strong reference, which a global id effectively does here
    // since nothing releases it in this single-connection test program.
    ((void (*)(id, SEL, id, id))objc_msgSend)(central, sel("connectPeripheral:options:"), peripheral, (id)NULL);
    ((msgsend_void_t)objc_msgSend)(central, sel("stopScan"));
}

static void delegate_did_connect(id self, SEL _cmd, id central, id peripheral) {
    (void)self; (void)_cmd; (void)central;
    printf("[CoreBLE] connected — discovering services...\n");

    // Set this program as the peripheral's own delegate too (service/
    // characteristic discovery callbacks arrive via CBPeripheralDelegate).
    id pdelegate = ((msgsend_id_t)objc_msgSend)(
        ((msgsend_id_t)objc_msgSend)((id)g_peripheral_delegate_class, sel("alloc")), sel("init"));
    ((msgsend_void_id_t)objc_msgSend)(peripheral, sel("setDelegate:"), pdelegate);

    ((void (*)(id, SEL, id))objc_msgSend)(peripheral, sel("discoverServices:"), (id)NULL);
}

static void delegate_did_fail_to_connect(id self, SEL _cmd, id central, id peripheral, id error) {
    (void)self; (void)_cmd; (void)central; (void)peripheral;
    id desc = ((msgsend_id_t)objc_msgSend)(error, sel("localizedDescription"));
    const char *desc_cstr = ((msgsend_cvoidptr_t)objc_msgSend)(desc, sel("UTF8String"));
    printf("[CoreBLE] connect failed: %s\n", desc_cstr ? desc_cstr : "(unknown)");
    g_peripheral = (id)NULL;
}

static void delegate_did_discover_services(id self, SEL _cmd, id peripheral, id error) {
    (void)self; (void)_cmd; (void)error;
    id services = ((msgsend_id_t)objc_msgSend)(peripheral, sel("services"));
    unsigned long count = ((msgsend_ulong_t)objc_msgSend)(services, sel("count"));
    for (unsigned long i = 0; i < count; i++) {
        id svc = ((msgsend_id_ulong_t)objc_msgSend)(services, sel("objectAtIndex:"), i);
        ((void (*)(id, SEL, id, id))objc_msgSend)(peripheral, sel("discoverCharacteristics:forService:"), (id)NULL, svc);
    }
}

static void delegate_did_discover_characteristics(id self, SEL _cmd, id peripheral, id service, id error) {
    (void)self; (void)_cmd; (void)error;
    id chars = ((msgsend_id_t)objc_msgSend)(service, sel("characteristics"));
    unsigned long count = ((msgsend_ulong_t)objc_msgSend)(chars, sel("count"));

    id rx_uuid = ((msgsend_id_arg1_t)objc_msgSend)(cls("CBUUID"), sel("UUIDWithString:"),
                    ((msgsend_id_cstr_t)objc_msgSend)(cls("NSString"), sel("stringWithUTF8String:"), NUS_RX_CHAR_UUID));
    id tx_uuid = ((msgsend_id_arg1_t)objc_msgSend)(cls("CBUUID"), sel("UUIDWithString:"),
                    ((msgsend_id_cstr_t)objc_msgSend)(cls("NSString"), sel("stringWithUTF8String:"), NUS_TX_CHAR_UUID));

    for (unsigned long i = 0; i < count; i++) {
        id ch = ((msgsend_id_ulong_t)objc_msgSend)(chars, sel("objectAtIndex:"), i);
        id uuid = ((msgsend_id_t)objc_msgSend)(ch, sel("UUID"));

        if (((msgsend_bool_id_arg1_t)objc_msgSend)(uuid, sel("isEqual:"), rx_uuid)) {
            g_rx_char = ch;
            printf("[CoreBLE] found RX characteristic.\n");
        } else if (((msgsend_bool_id_arg1_t)objc_msgSend)(uuid, sel("isEqual:"), tx_uuid)) {
            printf("[CoreBLE] found TX characteristic — subscribing.\n");
            ((void (*)(id, SEL, BOOL, id))objc_msgSend)(peripheral, sel("setNotifyValue:forCharacteristic:"), (BOOL)1, ch);
        }
    }
}

static void delegate_did_update_notification_state(id self, SEL _cmd, id peripheral, id characteristic, id error) {
    (void)self; (void)_cmd; (void)peripheral; (void)characteristic; (void)error;
    printf("[CoreBLE] subscribed to TX — starting link handshake.\n");
    g_connected = true;
    link_on_connected(1);
}

static void delegate_did_update_value(id self, SEL _cmd, id peripheral, id characteristic, id error) {
    (void)self; (void)_cmd; (void)peripheral; (void)characteristic; (void)error;
    id value = ((msgsend_id_t)objc_msgSend)(characteristic, sel("value"));
    if (value == (id)NULL) return;

    const void *bytes = ((msgsend_cvoidptr_t)objc_msgSend)(value, sel("bytes"));
    unsigned long len = ((msgsend_ulong_t)objc_msgSend)(value, sel("length"));
    if (bytes != NULL && len > 0 && len < 4096) {
        link_process_acl_rx((const uint8_t *)bytes, (uint16_t)len);
    }
}

// ---- Terminal input: type a line, offer it to the connected peripheral ----

static void stdin_readable(void *context) {
    (void)context;
    char line[512];
    if (fgets(line, sizeof(line), stdin) == NULL) return;

    size_t len = strnlen(line, sizeof(line));
    while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) line[--len] = '\0';
    if (len == 0) return;

    if (link_get_state() != LINK_STATE_READY) {
        printf("[Link] not ready yet.\n");
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

static void timer_fired(void *context) {
    (void)context;
    link_pump();
}

int main(void) {
    // Central manager delegate.
    Class cm_delegate_class = objc_allocateClassPair((Class)cls("NSObject"), "LinkCentralDelegate", 0);
    class_addMethod(cm_delegate_class, sel("centralManagerDidUpdateState:"), (IMP)delegate_did_update_state, "v@:@");
    class_addMethod(cm_delegate_class, sel("centralManager:didDiscoverPeripheral:advertisementData:RSSI:"),
                     (IMP)delegate_did_discover, "v@:@@@@");
    class_addMethod(cm_delegate_class, sel("centralManager:didConnectPeripheral:"), (IMP)delegate_did_connect, "v@:@@");
    class_addMethod(cm_delegate_class, sel("centralManager:didFailToConnectPeripheral:error:"),
                     (IMP)delegate_did_fail_to_connect, "v@:@@@");
    Protocol *cm_proto = objc_getProtocol("CBCentralManagerDelegate");
    if (cm_proto) class_addProtocol(cm_delegate_class, cm_proto);
    objc_registerClassPair(cm_delegate_class);

    // Peripheral delegate (separate class - CBPeripheralDelegate methods).
    g_peripheral_delegate_class = objc_allocateClassPair((Class)cls("NSObject"), "LinkPeripheralDelegate", 0);
    class_addMethod(g_peripheral_delegate_class, sel("peripheral:didDiscoverServices:"),
                     (IMP)delegate_did_discover_services, "v@:@@");
    class_addMethod(g_peripheral_delegate_class, sel("peripheral:didDiscoverCharacteristicsForService:error:"),
                     (IMP)delegate_did_discover_characteristics, "v@:@@@");
    class_addMethod(g_peripheral_delegate_class, sel("peripheral:didUpdateNotificationStateForCharacteristic:error:"),
                     (IMP)delegate_did_update_notification_state, "v@:@@@");
    class_addMethod(g_peripheral_delegate_class, sel("peripheral:didUpdateValueForCharacteristic:error:"),
                     (IMP)delegate_did_update_value, "v@:@@@");
    Protocol *p_proto = objc_getProtocol("CBPeripheralDelegate");
    if (p_proto) class_addProtocol(g_peripheral_delegate_class, p_proto);
    objc_registerClassPair(g_peripheral_delegate_class);

    id cm_delegate = ((msgsend_id_t)objc_msgSend)(
        ((msgsend_id_t)objc_msgSend)((id)cm_delegate_class, sel("alloc")), sel("init"));

    id mgr_alloc = ((msgsend_id_t)objc_msgSend)(cls("CBCentralManager"), sel("alloc"));
    g_central_mgr = ((msgsend_id_id_id_id_t)objc_msgSend)(mgr_alloc, sel("initWithDelegate:queue:options:"),
                                                           cm_delegate, (id)NULL, (id)NULL);

    link_init();
    link_set_local_name((const uint8_t *)"Sentinel-Central", 16);

    dispatch_source_t timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, 0), 50 * NSEC_PER_MSEC, 5 * NSEC_PER_MSEC);
    dispatch_source_set_event_handler_f(timer, timer_fired);
    dispatch_resume(timer);

    dispatch_source_t stdin_src = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, (uintptr_t)STDIN_FILENO, 0, dispatch_get_main_queue());
    dispatch_source_set_event_handler_f(stdin_src, stdin_readable);
    dispatch_resume(stdin_src);

    printf("[Central] Sentinel-Central running. Scanning for Sentinel-Mac...\n"
           "          Once linked, type a line + Enter to offer it to the connected peer.\n");

    dispatch_main();
    return 0;
}
