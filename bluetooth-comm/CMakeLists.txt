cmake_minimum_required(VERSION 3.20)
project(SentinelBluetoothComm C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# -----------------------------------------------------------------------------
# WASM Toolchain Settings
# -----------------------------------------------------------------------------
# Built directly with clang/wasm-ld against the wasm32-unknown-unknown target.
# No WASI SDK is required: the controller is bare-metal and only depends on
# the two host imports declared in bluetooth_controller.c
# (host_uart_write_bytes / host_uart_read_bytes).

if(NOT CMAKE_C_COMPILER_ID MATCHES "Clang")
    message(WARNING "Cross-compiling to wasm32-unknown-unknown requires LLVM/Clang.")
endif()

# -----------------------------------------------------------------------------
# Target: WASM Communication Module (wasm32-unknown-unknown)
# -----------------------------------------------------------------------------
# Features:
# - Zero stdlib (-nostdlib)
# - No entrypoint (-Wl,--no-entry)
# - Exports every controller_*/link_* function plus linear memory, so the
#   host (JS, or any embedder) can drive the state machine and read/write
#   the link layer's send/receive buffers directly.

add_executable(bluetooth_comm
    bluetooth_controller.c
    link_protocol.c
)

set(WASM_COMPILE_FLAGS "--target=wasm32-unknown-unknown -O3 -ffreestanding")
set(WASM_LINK_FLAGS
    "--target=wasm32-unknown-unknown "
    "-nostdlib "
    "-Wl,--no-entry "
    "-Wl,--allow-undefined "
    "-Wl,--export-all "
    "-Wl,--export-memory "
    "-Wl,-z,stack-size=65536"
)

string(REPLACE ";" "" WASM_LINK_FLAGS_STR "${WASM_LINK_FLAGS}")

set_target_properties(bluetooth_comm PROPERTIES
    SUFFIX ".wasm"
    COMPILE_FLAGS "${WASM_COMPILE_FLAGS}"
    LINK_FLAGS "${WASM_LINK_FLAGS_STR}"
)

# -----------------------------------------------------------------------------
# Optional Post-Build Binary Optimization (wasm-opt)
# -----------------------------------------------------------------------------

find_program(WASM_OPT wasm-opt)

if(WASM_OPT)
    message(STATUS "Found wasm-opt: ${WASM_OPT}. Enabling post-build optimization.")
    add_custom_command(TARGET bluetooth_comm POST_BUILD
        COMMAND ${WASM_OPT} -O3 $<TARGET_FILE:bluetooth_comm> -o $<TARGET_FILE:bluetooth_comm>
        COMMENT "Optimizing bluetooth_comm.wasm with wasm-opt -O3..."
    )
else()
    message(STATUS "wasm-opt not found. Binary optimization post-pass skipped.")
endif()

# -----------------------------------------------------------------------------
# Host Adapters (native shared libraries, for real hardware deployment)
# -----------------------------------------------------------------------------
# These are not part of the WASM build; they implement host_uart_write_bytes/
# host_uart_read_bytes natively so a non-browser embedder (Wasmtime, Wasmer,
# a custom native runtime) can feed the same WASM module real serial bytes.

if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    add_library(linux_adapter SHARED host_linux_adapter.c)
    target_link_libraries(linux_adapter pthread)
    set_target_properties(linux_adapter PROPERTIES C_VISIBILITY_PRESET hidden)
elseif(CMAKE_SYSTEM_NAME STREQUAL "Darwin")
    add_library(mac_adapter SHARED host_mac_adapter.c)
    target_link_libraries(mac_adapter pthread)
    set_target_properties(mac_adapter PROPERTIES C_VISIBILITY_PRESET hidden)
endif()
