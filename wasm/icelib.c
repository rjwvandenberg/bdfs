#define DEBUG 1

#include <stdlib.h>
#include "stdint.h"
#include "ice.h"
#include "blackdesert_unpack.h"

typedef uint8_t u8;
typedef uint32_t u32;

ICE_KEY *create_ice(const int level) {
    return ice_key_create(level);
}

void set_ice(ICE_KEY *ice, u8 *key){
    ice_key_set(ice, key);
}

void decrypt_ice(ICE_KEY *ice, u8 *compressed, u8 *plaintext) {
    ice_key_decrypt(ice, compressed, plaintext);
}

void encrypt_ice(ICE_KEY *ice, u8 *plaintext, u8 *compressed) {
    ice_key_encrypt(ice, plaintext, compressed);
}

void encrypt(ICE_KEY *ice, u8 *plaintext, u8 *compressed, int sections) {    
    for(int i=0; i<sections; i++) {
        encrypt_ice(ice, plaintext, compressed);
        plaintext += 8;
        compressed += 8;
    }
}

void decrypt(ICE_KEY *ice, u8 *compressed, u8 *plaintext, int sections) {
    for(int i=0; i<sections; i++) {
        decrypt_ice(ice, compressed, plaintext);
        compressed += 8;
        plaintext += 8;
    }
}

u32 unpack(u8 *in, u8 *out) {
    return blackdesert_unpack(in, out);
}

u8 *create_buffer(int length) {
    return (u8 *)calloc(length, sizeof(u8));
}

void destroy_buffer(u8 *p) {
    free(p);
}