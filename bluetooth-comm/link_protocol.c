// link_protocol.c
// Target: wasm32-unknown-unknown (-nostdlib -O3)
//
// See link_protocol.h for the protocol description. This file owns the
// wire framing and the single-transfer-per-direction state machine; it
// never touches the serial/HCI transport directly, only the ACL channel
// exposed by bluetooth_controller.c (controller_send_acl).

#include "link_protocol.h"
#include "sentinel_mem.h"

// --- Transport hook, implemented in bluetooth_controller.c ---
extern bool controller_send_acl(uint16_t conn_handle, const uint8_t *data, uint16_t len);

// --- Host notification: fired whenever something the UI should know about happens ---
__attribute__((import_module("env"), import_name("host_on_link_event")))
extern void host_on_link_event(uint32_t event_type, uint32_t a, uint32_t b);

// --- Sentinel Link Protocol (SLP) message types ---
#define SLP_HELLO           0x01
#define SLP_HELLO_ACK       0x02
#define SLP_OFFER           0x03
#define SLP_OFFER_ACCEPT    0x04
#define SLP_OFFER_DECLINE   0x05
#define SLP_CHUNK           0x06
#define SLP_CHUNK_ACK       0x07
#define SLP_COMPLETE        0x08
#define SLP_ERROR           0x09

#define SLP_FRAME_MAX        (5 + 5 + LINK_CHUNK_SIZE) // header + chunk header + data
#define SLP_HEADER_LEN        5

static link_state_t g_state = LINK_STATE_IDLE;
static uint16_t     g_conn_handle = 0;
static uint16_t     g_tx_seq = 0;

static uint8_t  g_local_name[LINK_MAX_NAME_LEN];
static uint8_t  g_local_name_len = 0;
static uint8_t  g_offer_name_scratch[LINK_MAX_NAME_LEN]; // host stages an outbound offer's name here
static uint8_t  g_peer_name[LINK_MAX_NAME_LEN];
static uint8_t  g_peer_name_len = 0;

// Outbound transfer (we are the sender)
static uint8_t  g_tx_payload[LINK_TX_BUFFER_SIZE];
static uint32_t g_tx_total_len = 0;
static uint32_t g_tx_sent_offset = 0;
static uint8_t  g_out_transfer_id = 0;
static uint16_t g_out_chunk_seq = 0;
static bool     g_waiting_for_ack = false;
static uint16_t g_last_chunk_len = 0;

// Inbound transfer (we are the receiver)
static uint8_t  g_rx_payload[LINK_RX_BUFFER_SIZE];
static uint32_t g_rx_received = 0;
static uint8_t  g_offer_name[LINK_MAX_NAME_LEN];
static uint8_t  g_offer_name_len = 0;
static uint8_t  g_offer_kind = 0;
static uint32_t g_offer_total_size = 0;
static uint8_t  g_in_transfer_id = 0;

static uint8_t  g_transfer_counter = 0;

static void link_send_frame(uint8_t msg_type, const uint8_t *payload, uint16_t payload_len) {
    uint8_t frame[SLP_FRAME_MAX];
    if (payload_len > SLP_FRAME_MAX - SLP_HEADER_LEN) payload_len = SLP_FRAME_MAX - SLP_HEADER_LEN;

    frame[0] = msg_type;
    frame[1] = (uint8_t)(g_tx_seq & 0xFF);
    frame[2] = (uint8_t)((g_tx_seq >> 8) & 0xFF);
    frame[3] = (uint8_t)(payload_len & 0xFF);
    frame[4] = (uint8_t)((payload_len >> 8) & 0xFF);
    if (payload_len > 0 && payload != NULL) {
        sentinel_memcpy(&frame[SLP_HEADER_LEN], payload, payload_len);
    }
    g_tx_seq++;

    controller_send_acl(g_conn_handle, frame, (uint16_t)(SLP_HEADER_LEN + payload_len));
}

void link_init(void) {
    g_state = LINK_STATE_IDLE;
    g_conn_handle = 0;
    g_tx_seq = 0;
    g_peer_name_len = 0;
    g_tx_total_len = 0;
    g_tx_sent_offset = 0;
    g_out_transfer_id = 0;
    g_out_chunk_seq = 0;
    g_waiting_for_ack = false;
    g_rx_received = 0;
    g_offer_name_len = 0;
    g_offer_total_size = 0;
    g_in_transfer_id = 0;
    g_transfer_counter = 0;
}

void link_set_local_name(const uint8_t *name, uint8_t len) {
    if (len > LINK_MAX_NAME_LEN) len = LINK_MAX_NAME_LEN;
    sentinel_memcpy(g_local_name, name, len);
    g_local_name_len = len;
}

void link_on_connected(uint16_t conn_handle) {
    g_conn_handle = conn_handle;
    g_tx_seq = 0;
    g_state = LINK_STATE_HANDSHAKING;

    uint8_t payload[1 + LINK_MAX_NAME_LEN];
    payload[0] = g_local_name_len;
    sentinel_memcpy(&payload[1], g_local_name, g_local_name_len);
    link_send_frame(SLP_HELLO, payload, (uint16_t)(1 + g_local_name_len));
}

void link_on_disconnected(void) {
    g_state = LINK_STATE_IDLE;
    g_conn_handle = 0;
    g_tx_total_len = 0;
    g_tx_sent_offset = 0;
    g_waiting_for_ack = false;
    g_rx_received = 0;
}

static void handle_hello(const uint8_t *payload, uint16_t len, bool is_ack) {
    if (len < 1) return;
    uint8_t name_len = payload[0];
    if (name_len > LINK_MAX_NAME_LEN) name_len = LINK_MAX_NAME_LEN;
    if ((uint16_t)(1 + name_len) > len) return;

    sentinel_memcpy(g_peer_name, &payload[1], name_len);
    g_peer_name_len = name_len;

    if (!is_ack) {
        uint8_t reply[1 + LINK_MAX_NAME_LEN];
        reply[0] = g_local_name_len;
        sentinel_memcpy(&reply[1], g_local_name, g_local_name_len);
        link_send_frame(SLP_HELLO_ACK, reply, (uint16_t)(1 + g_local_name_len));
    }

    g_state = LINK_STATE_READY;
    host_on_link_event(LINK_EVT_HELLO_RECEIVED, 0, 0);
}

static void handle_offer(const uint8_t *payload, uint16_t len) {
    // [transfer_id:1][name_len:1][name][total_size:4 LE][kind:1]
    if (len < 2) return;
    uint8_t transfer_id = payload[0];
    uint8_t name_len = payload[1];
    if (name_len > LINK_MAX_NAME_LEN) name_len = LINK_MAX_NAME_LEN;
    if ((uint16_t)(2 + name_len + 4 + 1) > len) return;

    const uint8_t *p = &payload[2];
    sentinel_memcpy(g_offer_name, p, name_len);
    g_offer_name_len = name_len;
    p += name_len;

    uint32_t total_size = (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
    p += 4;
    uint8_t kind = p[0];

    g_offer_total_size = total_size;
    g_offer_kind = kind;
    g_in_transfer_id = transfer_id;
    g_rx_received = 0;
    g_state = LINK_STATE_INBOUND_OFFERED;

    host_on_link_event(LINK_EVT_OFFER_RECEIVED, transfer_id, total_size);
}

static void handle_offer_accept(const uint8_t *payload, uint16_t len) {
    if (len < 1) return;
    if (payload[0] != g_out_transfer_id || g_state != LINK_STATE_OUTBOUND_OFFERED) return;

    g_state = LINK_STATE_OUTBOUND_SENDING;
    g_tx_sent_offset = 0;
    g_out_chunk_seq = 0;
    g_waiting_for_ack = false;
    host_on_link_event(LINK_EVT_OFFER_ACCEPTED, g_out_transfer_id, 0);
}

static void handle_offer_decline(const uint8_t *payload, uint16_t len) {
    if (len < 1) return;
    if (payload[0] != g_out_transfer_id) return;

    g_state = LINK_STATE_READY;
    g_tx_total_len = 0;
    host_on_link_event(LINK_EVT_OFFER_DECLINED, g_out_transfer_id, 0);
}

static void handle_chunk(const uint8_t *payload, uint16_t len) {
    // [transfer_id:1][chunk_seq:2 LE][chunk_len:2 LE][data...]
    if (len < 5) return;
    uint8_t transfer_id = payload[0];
    uint16_t chunk_len = (uint16_t)payload[3] | ((uint16_t)payload[4] << 8);
    if ((uint16_t)(5 + chunk_len) > len) return;

    if (transfer_id != g_in_transfer_id ||
        (g_state != LINK_STATE_INBOUND_RECEIVING && g_state != LINK_STATE_INBOUND_OFFERED)) {
        return;
    }

    if (g_rx_received + chunk_len <= LINK_RX_BUFFER_SIZE) {
        sentinel_memcpy(&g_rx_payload[g_rx_received], &payload[5], chunk_len);
        g_rx_received += chunk_len;
    }

    uint8_t ack_payload[1];
    ack_payload[0] = transfer_id;
    link_send_frame(SLP_CHUNK_ACK, ack_payload, 1);

    host_on_link_event(LINK_EVT_CHUNK_PROGRESS, transfer_id, g_rx_received);
}

static void handle_chunk_ack(const uint8_t *payload, uint16_t len) {
    if (len < 1) return;
    if (payload[0] != g_out_transfer_id || g_state != LINK_STATE_OUTBOUND_SENDING) return;

    g_tx_sent_offset += g_last_chunk_len;
    g_waiting_for_ack = false;
}

static void handle_complete(const uint8_t *payload, uint16_t len) {
    if (len < 1) return;
    uint8_t transfer_id = payload[0];
    if (transfer_id != g_in_transfer_id) return;

    host_on_link_event(LINK_EVT_TRANSFER_COMPLETE, transfer_id, g_rx_received);
    g_state = LINK_STATE_READY;
}

void link_process_acl_rx(const uint8_t *pdu, uint16_t pdu_len) {
    if (pdu_len < SLP_HEADER_LEN) return;

    uint8_t msg_type = pdu[0];
    uint16_t payload_len = (uint16_t)pdu[3] | ((uint16_t)pdu[4] << 8);
    if ((uint16_t)(SLP_HEADER_LEN + payload_len) > pdu_len) return;

    const uint8_t *payload = &pdu[SLP_HEADER_LEN];

    switch (msg_type) {
        case SLP_HELLO:         handle_hello(payload, payload_len, false); break;
        case SLP_HELLO_ACK:     handle_hello(payload, payload_len, true);  break;
        case SLP_OFFER:         handle_offer(payload, payload_len);        break;
        case SLP_OFFER_ACCEPT:  handle_offer_accept(payload, payload_len); break;
        case SLP_OFFER_DECLINE: handle_offer_decline(payload, payload_len);break;
        case SLP_CHUNK:         handle_chunk(payload, payload_len);        break;
        case SLP_CHUNK_ACK:     handle_chunk_ack(payload, payload_len);    break;
        case SLP_COMPLETE:      handle_complete(payload, payload_len);     break;
        case SLP_ERROR:
            if (payload_len >= 1) host_on_link_event(LINK_EVT_ERROR, payload[0], 0);
            break;
        default:
            break;
    }
}

void link_pump(void) {
    if (g_state != LINK_STATE_OUTBOUND_SENDING) return;
    if (g_waiting_for_ack) return;

    if (g_tx_sent_offset >= g_tx_total_len) {
        uint8_t payload[1];
        payload[0] = g_out_transfer_id;
        link_send_frame(SLP_COMPLETE, payload, 1);
        host_on_link_event(LINK_EVT_TRANSFER_COMPLETE, g_out_transfer_id, g_tx_total_len);
        g_state = LINK_STATE_READY;
        g_tx_total_len = 0;
        return;
    }

    uint32_t remaining = g_tx_total_len - g_tx_sent_offset;
    uint16_t chunk_len = (remaining < LINK_CHUNK_SIZE) ? (uint16_t)remaining : LINK_CHUNK_SIZE;

    uint8_t payload[5 + LINK_CHUNK_SIZE];
    payload[0] = g_out_transfer_id;
    payload[1] = (uint8_t)(g_out_chunk_seq & 0xFF);
    payload[2] = (uint8_t)((g_out_chunk_seq >> 8) & 0xFF);
    payload[3] = (uint8_t)(chunk_len & 0xFF);
    payload[4] = (uint8_t)((chunk_len >> 8) & 0xFF);
    sentinel_memcpy(&payload[5], &g_tx_payload[g_tx_sent_offset], chunk_len);

    link_send_frame(SLP_CHUNK, payload, (uint16_t)(5 + chunk_len));

    g_last_chunk_len = chunk_len;
    g_out_chunk_seq++;
    g_waiting_for_ack = true;
}

uint8_t *link_get_tx_buffer(void) {
    return g_tx_payload;
}

uint8_t *link_get_offer_name_scratch(void) {
    return g_offer_name_scratch;
}

bool link_offer_send(uint32_t data_len, const uint8_t *name, uint8_t name_len, uint8_t kind) {
    if (g_state != LINK_STATE_READY) return false;
    if (data_len > LINK_TX_BUFFER_SIZE) return false;
    if (name_len > LINK_MAX_NAME_LEN) name_len = LINK_MAX_NAME_LEN;

    g_transfer_counter++;
    if (g_transfer_counter == 0) g_transfer_counter = 1; // avoid 0 (reserved)
    g_out_transfer_id = g_transfer_counter;

    g_tx_total_len = data_len;
    g_tx_sent_offset = 0;
    g_out_chunk_seq = 0;
    g_waiting_for_ack = false;

    uint8_t payload[2 + LINK_MAX_NAME_LEN + 4 + 1];
    payload[0] = g_out_transfer_id;
    payload[1] = name_len;
    sentinel_memcpy(&payload[2], name, name_len);
    uint8_t *p = &payload[2 + name_len];
    p[0] = (uint8_t)(data_len & 0xFF);
    p[1] = (uint8_t)((data_len >> 8) & 0xFF);
    p[2] = (uint8_t)((data_len >> 16) & 0xFF);
    p[3] = (uint8_t)((data_len >> 24) & 0xFF);
    p[4] = kind;

    link_send_frame(SLP_OFFER, payload, (uint16_t)(2 + name_len + 4 + 1));
    g_state = LINK_STATE_OUTBOUND_OFFERED;
    return true;
}

void link_offer_respond(bool accept) {
    if (g_state != LINK_STATE_INBOUND_OFFERED) return;

    uint8_t payload[1];
    payload[0] = g_in_transfer_id;

    if (accept) {
        g_state = LINK_STATE_INBOUND_RECEIVING;
        g_rx_received = 0;
        link_send_frame(SLP_OFFER_ACCEPT, payload, 1);
    } else {
        g_state = LINK_STATE_READY;
        link_send_frame(SLP_OFFER_DECLINE, payload, 1);
    }
}

uint8_t *link_get_rx_buffer(void) {
    return g_rx_payload;
}

uint32_t link_get_rx_length(void) {
    return g_rx_received;
}

const uint8_t *link_get_offer_name(void)  { return g_offer_name; }
uint8_t         link_get_offer_name_len(void) { return g_offer_name_len; }
uint8_t         link_get_offer_kind(void) { return g_offer_kind; }
const uint8_t  *link_get_peer_name(void)  { return g_peer_name; }
uint8_t         link_get_peer_name_len(void) { return g_peer_name_len; }

uint32_t link_get_state(void) { return (uint32_t)g_state; }
