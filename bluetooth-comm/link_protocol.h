// link_protocol.h
// Sentinel Link Protocol (SLP) — the application communication layer.
//
// Rides on top of the HCI ACL data channel exposed by bluetooth_controller.c.
// Unlike a pure "receiver" model (AirDrop's download-only share sheet), SLP is
// symmetric: either side of a connection can offer data to the other at any
// time after the HELLO handshake completes, and both directions can be
// in flight simultaneously. Peers negotiate each transfer explicitly
// (OFFER / ACCEPT / DECLINE) before any payload bytes move.
//
// Scope note: this is a demo-grade transport, not a certified GATT/L2CAP
// stack. It assumes a single logical connection, one inbound and one
// outbound transfer at a time, and no encryption — all of which are called
// out so they're not mistaken for production BLE behavior.

#ifndef LINK_PROTOCOL_H
#define LINK_PROTOCOL_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

#define LINK_TX_BUFFER_SIZE   4096
#define LINK_RX_BUFFER_SIZE   4096
#define LINK_MAX_NAME_LEN     32
#define LINK_CHUNK_SIZE       128

typedef enum {
    LINK_EVT_HELLO_RECEIVED     = 1,
    LINK_EVT_OFFER_RECEIVED     = 2,
    LINK_EVT_OFFER_ACCEPTED     = 3,
    LINK_EVT_OFFER_DECLINED     = 4,
    LINK_EVT_CHUNK_PROGRESS     = 5,
    LINK_EVT_TRANSFER_COMPLETE  = 6,
    LINK_EVT_ERROR              = 7
} link_event_t;

typedef enum {
    LINK_STATE_IDLE = 0,        // not connected
    LINK_STATE_HANDSHAKING,     // connected, HELLO sent, awaiting HELLO_ACK
    LINK_STATE_READY,           // handshake complete, free to offer/receive
    LINK_STATE_OUTBOUND_OFFERED,
    LINK_STATE_OUTBOUND_SENDING,
    LINK_STATE_INBOUND_OFFERED,
    LINK_STATE_INBOUND_RECEIVING
} link_state_t;

// --- Lifecycle (called by bluetooth_controller.c) ---
void     link_init(void);
void     link_on_connected(uint16_t conn_handle);
void     link_on_disconnected(void);
void     link_process_acl_rx(const uint8_t *pdu, uint16_t pdu_len);
void     link_pump(void); // call once per host tick; paces outbound chunks

// --- Local identity ---
void     link_set_local_name(const uint8_t *name, uint8_t len);

// --- Outbound transfer (this device is the sender) ---
uint8_t *link_get_tx_buffer(void);
uint8_t *link_get_offer_name_scratch(void); // host stages the offer's display name here
bool     link_offer_send(uint32_t data_len, const uint8_t *name, uint8_t name_len, uint8_t kind);

// --- Inbound transfer (this device is the receiver) ---
void     link_offer_respond(bool accept);
uint8_t *link_get_rx_buffer(void);
uint32_t link_get_rx_length(void);

// --- Offer / peer introspection (valid after the relevant event fires) ---
const uint8_t *link_get_offer_name(void);
uint8_t         link_get_offer_name_len(void);
uint8_t         link_get_offer_kind(void);
const uint8_t  *link_get_peer_name(void);
uint8_t         link_get_peer_name_len(void);

// --- Telemetry ---
uint32_t link_get_state(void);

#ifdef __cplusplus
}
#endif

#endif // LINK_PROTOCOL_H
