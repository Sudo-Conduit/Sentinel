// bluetooth_controller.c
// Target: wasm32-unknown-unknown (-nostdlib -O3)
//
// HCI-level BLE controller: brings the radio up, scans, and connects to the
// first peer it hears advertise. Once connected it hands the connection
// handle to link_protocol.c, which owns the actual application communication
// layer (see link_protocol.h). This file only ever speaks HCI: commands,
// events, and (post-connection) raw ACL data framing — it has no idea what
// bytes travel over the link once it's up.

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#include "link_protocol.h"
#include "sentinel_mem.h"

// --- Host Imports ---
__attribute__((import_module("env"), import_name("host_uart_write_bytes")))
extern uint32_t host_uart_write_bytes(const uint8_t *buf, uint32_t len);

__attribute__((import_module("env"), import_name("host_uart_read_bytes")))
extern uint32_t host_uart_read_bytes(uint8_t *buf, uint32_t max_len);

// --- HCI Packet Indicators ---
#define HCI_COMMAND_PKT   0x01
#define HCI_ACLDATA_PKT   0x02
#define HCI_EVENT_PKT     0x04

// --- HCI Opcodes (OGF << 10 | OCF) ---
#define HCI_OP_RESET                     0x0C03 // Controller & Baseband
#define HCI_OP_SET_EVENT_MASK            0x0C01
#define HCI_OP_DISCONNECT                0x0406 // Link Control
#define HCI_OP_READ_LOCAL_VERSION        0x1001 // Informational Parameters
#define HCI_OP_BLE_SET_SCAN_PARAMS       0x200B // LE Controller
#define HCI_OP_BLE_SET_SCAN_ENABLE       0x200C
#define HCI_OP_LE_CREATE_CONNECTION      0x200D

// --- HCI Event Codes ---
#define HCI_EVT_INQUIRY_COMPLETE         0x01
#define HCI_EVT_DISCONNECTION_COMPLETE   0x05
#define HCI_EVT_COMMAND_COMPLETE         0x0E
#define HCI_EVT_COMMAND_STATUS           0x0F
#define HCI_EVT_LE_META                  0x3E

#define HCI_LE_SUBEVT_CONNECTION_COMPLETE  0x01
#define HCI_EVT_LE_ADVERTISING_REPORT      0x02

// --- Controller States ---
typedef enum {
    STATE_UNINITIALIZED = 0,
    STATE_SENDING_RESET,
    STATE_WAIT_RESET_ACK,
    STATE_SETTING_EVENT_MASK,
    STATE_CONFIGURING_LE_SCAN,
    STATE_SCANNING_ACTIVE,
    STATE_CONNECTING,
    STATE_CONNECTED,
    STATE_ERROR
} controller_state_t;

static controller_state_t g_state = STATE_UNINITIALIZED;
static uint32_t           g_packets_sent = 0;
static uint32_t           g_events_parsed = 0;

static bool     g_connect_requested = false;
static uint8_t  g_peer_addr_type = 0;
static uint8_t  g_peer_addr[6];
static uint16_t g_conn_handle = 0;

// --- HCI Command Transmitter ---
static bool send_hci_command(uint16_t opcode, uint8_t param_len, const uint8_t *params) {
    uint8_t frame[260];
    frame[0] = HCI_COMMAND_PKT;
    frame[1] = (uint8_t)(opcode & 0xFF);
    frame[2] = (uint8_t)((opcode >> 8) & 0xFF);
    frame[3] = param_len;

    if (param_len > 0 && params != NULL) {
        sentinel_memcpy(&frame[4], params, param_len);
    }

    uint32_t total_len = 4 + param_len;
    uint32_t written = host_uart_write_bytes(frame, total_len);

    if (written == total_len) {
        g_packets_sent++;
        return true;
    }
    return false;
}

// --- ACL Data Transmitter (used by link_protocol.c) ---
// Simplified single-frame HCI ACL framing: indicator, 16-bit connection
// handle, 16-bit payload length, payload. Real HCI packs handle+flags into
// 16 bits and supports fragmentation; both are unnecessary for this demo's
// small link-layer frames, which always fit in one ACL packet.
bool controller_send_acl(uint16_t conn_handle, const uint8_t *data, uint16_t len) {
    uint8_t frame[5 + 256];
    if (len > 256) return false;

    frame[0] = HCI_ACLDATA_PKT;
    frame[1] = (uint8_t)(conn_handle & 0xFF);
    frame[2] = (uint8_t)((conn_handle >> 8) & 0xFF);
    frame[3] = (uint8_t)(len & 0xFF);
    frame[4] = (uint8_t)((len >> 8) & 0xFF);
    sentinel_memcpy(&frame[5], data, len);

    uint32_t total_len = 5 + len;
    uint32_t written = host_uart_write_bytes(frame, total_len);

    if (written == total_len) {
        g_packets_sent++;
        return true;
    }
    return false;
}

// --- Controller API / Commands ---

void controller_init(void) {
    g_state = STATE_SENDING_RESET;
    g_connect_requested = false;
    g_conn_handle = 0;
    link_init();
}

void controller_set_local_name(const uint8_t *name, uint8_t len) {
    link_set_local_name(name, len);
}

void controller_disconnect(void) {
    if (g_state != STATE_CONNECTED) return;

    uint8_t params[3];
    params[0] = (uint8_t)(g_conn_handle & 0xFF);
    params[1] = (uint8_t)((g_conn_handle >> 8) & 0xFF);
    params[2] = 0x13; // reason: Remote User Terminated Connection
    send_hci_command(HCI_OP_DISCONNECT, 3, params);
}

void controller_step_state_machine(void) {
    switch (g_state) {
        case STATE_SENDING_RESET:
            if (send_hci_command(HCI_OP_RESET, 0, NULL)) {
                g_state = STATE_WAIT_RESET_ACK;
            }
            break;

        case STATE_SETTING_EVENT_MASK: {
            // Enable standard HCI events (8-byte mask)
            uint8_t mask[8] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xBF, 0x00, 0x00 };
            if (send_hci_command(HCI_OP_SET_EVENT_MASK, 8, mask)) {
                g_state = STATE_CONFIGURING_LE_SCAN;
            }
            break;
        }

        case STATE_CONFIGURING_LE_SCAN: {
            // Active Scanning (0x01), Interval 0x0010 (10ms), Window 0x0010 (10ms), Public Addr
            uint8_t scan_params[7] = { 0x01, 0x10, 0x00, 0x10, 0x00, 0x00, 0x00 };
            if (send_hci_command(HCI_OP_BLE_SET_SCAN_PARAMS, 7, scan_params)) {
                // Enable BLE Scanning (0x01), Filter Duplicates (0x01)
                uint8_t scan_enable[2] = { 0x01, 0x01 };
                send_hci_command(HCI_OP_BLE_SET_SCAN_ENABLE, 2, scan_enable);
                g_state = STATE_SCANNING_ACTIVE;
            }
            break;
        }

        case STATE_SCANNING_ACTIVE:
            if (g_connect_requested) {
                uint8_t params[25];
                params[0] = 0x60; params[1] = 0x00; // scan interval
                params[2] = 0x30; params[3] = 0x00; // scan window
                params[4] = 0x00;                    // filter policy: use peer addr
                params[5] = g_peer_addr_type;
                sentinel_memcpy(&params[6], g_peer_addr, 6);
                params[12] = 0x00;                   // own addr type: public
                params[13] = 0x18; params[14] = 0x00; // conn interval min
                params[15] = 0x28; params[16] = 0x00; // conn interval max
                params[17] = 0x00; params[18] = 0x00; // conn latency
                params[19] = 0xA0; params[20] = 0x02; // supervision timeout
                params[21] = 0x00; params[22] = 0x00; // min CE length
                params[23] = 0x00; params[24] = 0x00; // max CE length

                if (send_hci_command(HCI_OP_LE_CREATE_CONNECTION, 25, params)) {
                    g_state = STATE_CONNECTING;
                }
            }
            break;

        case STATE_CONNECTED:
            link_pump();
            break;

        case STATE_WAIT_RESET_ACK:
        case STATE_CONNECTING:
        case STATE_UNINITIALIZED:
        case STATE_ERROR:
        default:
            break;
    }
}

// --- Incoming HCI Packet Event Parser ---

static void handle_command_complete(uint16_t opcode, const uint8_t *return_params, uint8_t len) {
    (void)return_params;
    (void)len;

    if (opcode == HCI_OP_RESET && g_state == STATE_WAIT_RESET_ACK) {
        g_state = STATE_SETTING_EVENT_MASK;
    }
}

static void handle_le_connection_complete(const uint8_t *payload, uint8_t len) {
    // payload: status(1) handle(2) role(1) peer_addr_type(1) peer_addr(6) ...
    if (len < 5) return;
    uint8_t status = payload[0];

    if (status != 0x00) {
        g_state = STATE_SCANNING_ACTIVE;
        g_connect_requested = false;
        return;
    }

    g_conn_handle = (uint16_t)payload[1] | ((uint16_t)payload[2] << 8);
    g_state = STATE_CONNECTED;
    link_on_connected(g_conn_handle);
}

static void handle_le_advertising_report(const uint8_t *payload, uint8_t len) {
    // Simplified: assumes a single report (num_reports == 1), which is all
    // this demo's simulated peers ever send.
    // payload: num_reports(1) event_type(1) addr_type(1) addr(6) data_len(1) data[..] rssi(1)
    if (len < 10) return;
    uint8_t num_reports = payload[0];
    if (num_reports < 1) return;

    if (!g_connect_requested && g_state == STATE_SCANNING_ACTIVE) {
        g_peer_addr_type = payload[2];
        sentinel_memcpy(g_peer_addr, &payload[3], 6);
        g_connect_requested = true;
    }
}

static void handle_le_meta_event(const uint8_t *payload, uint8_t len) {
    if (len < 1) return;
    uint8_t subevent = payload[0];

    if (subevent == HCI_EVT_LE_ADVERTISING_REPORT) {
        handle_le_advertising_report(&payload[1], (uint8_t)(len - 1));
    } else if (subevent == HCI_LE_SUBEVT_CONNECTION_COMPLETE) {
        handle_le_connection_complete(&payload[1], (uint8_t)(len - 1));
    }
}

static void handle_disconnection_complete(const uint8_t *payload, uint8_t len) {
    if (len < 3) return;
    uint8_t status = payload[0];
    if (status != 0x00) return;

    link_on_disconnected();
    g_conn_handle = 0;
    g_connect_requested = false;
    g_state = STATE_SCANNING_ACTIVE;
}

static void parse_hci_event(const uint8_t *evt_buf, uint32_t len) {
    if (len < 2) return; // Event Code (1) + Param Len (1)

    uint8_t event_code = evt_buf[0];
    uint8_t param_len  = evt_buf[1];

    if (len < (uint32_t)(2 + param_len)) return; // Incomplete payload

    g_events_parsed++;
    const uint8_t *payload = &evt_buf[2];

    switch (event_code) {
        case HCI_EVT_COMMAND_COMPLETE: {
            if (param_len >= 3) {
                uint16_t opcode = (uint16_t)payload[1] | ((uint16_t)payload[2] << 8);
                handle_command_complete(opcode, &payload[3], param_len - 3);
            }
            break;
        }
        case HCI_EVT_LE_META:
            handle_le_meta_event(payload, param_len);
            break;

        case HCI_EVT_DISCONNECTION_COMPLETE:
            handle_disconnection_complete(payload, param_len);
            break;

        default:
            break;
    }
}

// --- ACL Data Handler ---
// Frame: indicator(1) conn_handle(2 LE) payload_len(2 LE) payload(...)
static void parse_acl_data(const uint8_t *buf, uint32_t len) {
    if (len < 4) return;
    uint16_t handle = (uint16_t)buf[0] | ((uint16_t)buf[1] << 8);
    uint16_t payload_len = (uint16_t)buf[2] | ((uint16_t)buf[3] << 8);
    if ((uint32_t)(4 + payload_len) > len) return;
    if (g_state != STATE_CONNECTED || handle != g_conn_handle) return;

    link_process_acl_rx(&buf[4], payload_len);
}

// --- Main Ingestion Loop called by Runtime ---

void controller_process_rx(void) {
    uint8_t rx_buf[512];
    uint32_t bytes_read = host_uart_read_bytes(rx_buf, sizeof(rx_buf));

    if (bytes_read == 0) return;

    uint32_t idx = 0;
    while (idx < bytes_read) {
        if (rx_buf[idx] == HCI_EVENT_PKT) {
            if (idx + 2 < bytes_read) {
                uint8_t param_len = rx_buf[idx + 2];
                uint32_t pkt_len = 1 + 1 + 1 + param_len; // Indicator + Code + Len + Payload

                if (idx + pkt_len <= bytes_read) {
                    parse_hci_event(&rx_buf[idx + 1], pkt_len - 1);
                    idx += pkt_len;
                    continue;
                }
            }
        } else if (rx_buf[idx] == HCI_ACLDATA_PKT) {
            if (idx + 4 < bytes_read) {
                uint16_t payload_len = (uint16_t)rx_buf[idx + 3] | ((uint16_t)rx_buf[idx + 4] << 8);
                uint32_t pkt_len = 1 + 4 + payload_len; // Indicator + handle+len header + payload

                if (idx + pkt_len <= bytes_read) {
                    parse_acl_data(&rx_buf[idx + 1], pkt_len - 1);
                    idx += pkt_len;
                    continue;
                }
            }
        }
        idx++; // Advance byte-by-byte if framing alignment is lost
    }
}

void controller_tick(void) {
    controller_process_rx();
    controller_step_state_machine();
}

// Exported Getters for Host Telemetry
uint32_t get_controller_state(void)  { return (uint32_t)g_state; }
uint32_t get_packets_sent(void)      { return g_packets_sent; }
uint32_t get_events_parsed(void)     { return g_events_parsed; }
uint32_t get_conn_handle(void)       { return (uint32_t)g_conn_handle; }
