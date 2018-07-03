var program = [];
var PC = [0, 0];
var stepnum = 0;
var RAM = [];
var bps_read = [];
var bps_write = [];
var bps_inst = [];
var inst_break = 0;
var RAMdisplay = [];

var busses = [];
var reinit_busses = true;

function bin(x) {
    return x >= 0 ? ("0000000000000000"+x.toString(2)).slice(-16) : ("1111111111111111"+((65535^-x)+1).toString(2)).slice(-16);
}

function addRAMslots(addr) {
    while (addr >= RAM.length) {
        RAM.push([0,0,0]);
        $('#ram-bank').append($('<tr><td>'+(RAM.length-1)+'</td><td>'+bin(RAM.length-1)+'</td><td>0</td><td>'+bin(0)+'</td><td>0</td><td>0</td></tr>'));
    }
}

function RAMwrite(addr, val, inc = 1) {
    addRAMslots(addr);
    
    if (val < 0) { val = (65535^-val)+1; }
    val = val & 65535; //16-bit words
    if (addr === 0) { PC[1] = val; }
    
    RAM[addr][0] = val;
    RAM[addr][2] += inc;
    var row = $('#ram-bank tr')[addr+1].children;
    $(row[2]).text(val);
    $(row[3]).text(bin(val));
    $(row[5]).text(RAM[addr][2]);
    
    if (RAMdisplay.indexOf(addr)>=0){ update_display(addr); }
    if (bps_write.indexOf(addr)>=0){ stop_code(); }
}

function RAMread(addr) {
    directAddr = parseInt($('#directWriteAddr').val());
    directVal = parseInt($('#directWriteVal').val());
    
    if(addr === directAddr){
        if(directVal){
            RAMwrite(directAddr, directVal);
            $('#directWriteVal').val("")
        } else {
            if($('#breakOnBlank').prop('checked')){
                stop_code();
                return;
            }
        }
    }
    
    addRAMslots(addr);
    
    RAM[addr][1]++;
    $($('#ram-bank tr')[addr+1].children[4]).text(RAM[addr][1]);
    
    if (bps_read.indexOf(addr)>=0){ stop_code(); }
    
    return RAM[addr][0];
}

function MNZ(test, val, dest){ if (test){ RAMwrite(dest, val); } }
function MLZ(test, val, dest){ if (test<0 || test>=32768){ RAMwrite(dest, val); } }
function ADD(val1, val2, dest){ RAMwrite(dest, val1+val2); }
function SUB(val1, val2, dest){ RAMwrite(dest, val1-val2); }
function AND(val1, val2, dest){ RAMwrite(dest, val1&val2); }
function OR(val1, val2, dest){ RAMwrite(dest, val1|val2); }
function XOR(val1, val2, dest){ RAMwrite(dest, val1^val2); }
function ANT(val1, val2, dest){ RAMwrite(dest, val1&(val2^65535)); }
function SL(val1, val2, dest){ RAMwrite(dest, val1<<val2); }
function SRL(val1, val2, dest){ RAMwrite(dest, (val1&65535)>>val2); }
function SRA(val1, val2, dest){ RAMwrite(dest, ((val1&65535)>>val2) + ((val1&65535) >= 32768 ? ((1<<val2)-1)<<(16-val2) : 0)); }

function SND(bus, val, dest) { 
    var bus = busses[bus]; 

    if (bus !== undefined) { 
        RAMwrite(dest, bus[0].write(String.fromCharCode(val)));
    } else {
        RAMwrite(dest, 0);
    }
}

function RCV(bus, jump, dest) {
    var bus = busses[bus];

    if (bus !== undefined) {
        var val = bus[0].buffer.shift();

        if (val !== undefined) {
            RAMwrite(dest, val);
            return;
        }
    }

    RAMwrite(0, jump);
}

var opnames = ["MNZ","MLZ","ADD","SUB","AND","OR","XOR","ANT","SL","SRL","SRA","SND","RCV"];

$(document).ready(function(){ set_code(); });

function set_code() {
    stop_code();

    var code = $('#asm-code').val();
    var lines = code.split("\n");
    new_program = [];
    
    PC = [0, 0];
    stepnum = 0;
    RAM = [];
    inst_break = 0;
    $($('#machine-code tr').slice(2)).remove();
    $($('#ram-bank tr').slice(1)).remove();
    $('#error').text("");
    $('#pc').text("0");
    
    for (var i=0; i<lines.length; i++) {
        var nocomment = lines[i].split(";")[0];
        
        var table_row = $('<tr></tr>');
        table_row.append($('<td colspan=2 class="asm">'+nocomment+'</td>'));
        
        var parts = nocomment.split(" ");
        
        if (opnames.indexOf(parts[1]) < 0){ $('#error').text("Command "+parts[1]+" on line "+i+" is invalid."); return; }
        
        new_program.push({"line-num": parts[0].slice(0,parts[0].length-1),
                          "opname": parts[1],
                          "opcode": opnames.indexOf(parts[1]),
                          "add1": parts[2],
                          "add2": parts[3],
                          "add3": parts[4]
                         });
        
        table_row.append($('<td colspan=2>'+("0000"+new_program[i]["opcode"].toString(2)).slice(-4)+'</td>'));
        
        for (var j=0; j<3; j++) {
            var type = ['','A','B','C'].indexOf(parts[j+2].slice(0,1));
            var loc;
            
            if (type<0) {
                type=0
                loc = parseInt(parts[j+2]);
            } else {
                loc = parseInt(parts[j+2].slice(1));
            }
            
            new_program[i]["add"+(j+1)+"_type"] = type
            new_program[i]["add"+(j+1)+"_loc"] = loc
            
            table_row.append($('<td>'+("00"+type.toString(2)).slice(-2)+'</td>'));
            table_row.append($('<td>'+bin(loc)+'</td>'));
        }
        
        $('#machine-code').append(table_row);
    }
    
    program = new_program;
    $($('#machine-code tr')[2]).addClass('highlight');
    $($('#machine-code tr')[3]).addClass('highlight2');
    enable_buttons();
}

function step_code() {
    if (PC[0] >= program.length) {
        $('#error').text("Program finished!");
        disable_buttons();
        stop_code();
        return;
    }
    
    if (bps_inst.indexOf(PC[0]) >= 0){
        if (!inst_break){
            stop_code();
            inst_break = 1;
            return;
        } else {
            inst_break -= 1;
        }
    }

    if (reinit_busses) {
        busses.forEach(function(x) {
            x[0].init();
        });

        reinit_busses = false;
    }
    
    stepnum++;
    var inst = program[PC[0]];
    var vals = [];
    
    $('#stepnum').text(stepnum);
    $($('#machine-code tr')[PC[0]+2]).removeClass('highlight');
    $($('#machine-code tr')[PC[1]+3]).removeClass('highlight2');
    
    for (var i=0; i<3; i++) {
        var val = inst["add"+(i+1)+"_loc"];
        
        for (var j=0; j<inst["add"+(i+1)+"_type"]; j++) {
            val = RAMread(val);
        }
        
        vals.push(val);
    }
    
    PC[1] = PC[1] + 1;
    PC[0] = PC[1];
    RAMwrite(0, PC[1], 0);
    
    window[inst["opname"]](vals[0], vals[1], vals[2]);
    
    $('#pc').text(PC[0]);
    $($('#machine-code tr')[PC[0]+2]).addClass('highlight');
    $($('#machine-code tr')[PC[1]+3]).addClass('highlight2');
}

var code_timer;

function run_code() {
    if (!code_timer) {
        code_timer = setInterval(step_code, 1);
        $('#run-code').html("Stop");
    } else {
        stop_code();
    }
}

function stop_code() {
    clearInterval(code_timer);
    code_timer = 0;
    $('#run-code').html("Run");
    $('#slow-code').html("Slow");

    busses.forEach(function(x) {
        x[0].close();
    });

    reinit_busses = true;
}

function slow_code() {
    if (!code_timer){
        code_timer = setInterval(step_code, $('#mspt').val());
        $('#slow-code').html("Stop");
    } else {
        stop_code();
    }
}

function enable_buttons(){
    $('#run-code').prop('disabled', false);
    $('#step-code').prop('disabled', false);
    $('#slow-code').prop('disabled', false);
}
function disable_buttons(){
    $('#run-code').prop('disabled', true);
    $('#step-code').prop('disabled', true);
    $('#slow-code').prop('disabled', true);
}

function set_breakpoints(kind){
    if (kind === 'inst'){
        var bpsi = $('#breakpoints-inst').val();
        bps_inst = bpsi ? bpsi.split(/(,| )[ ]*/).map(Number) : [];
    } else if (kind === 'read'){
        var bpsr = $('#breakpoints-read').val();
        bps_read = bpsr ? bpsr.split(/(,| )[ ]*/).map(Number) : [];
    } else if (kind === 'write'){
        var bpsw = $('#breakpoints-write').val();
        bps_write = bpsw ? bpsw.split(/(,| )[ ]*/).map(Number) : [];
    }    
}

function set_RAMdisplay(){
    var Rdisp = $('#RAMdisplay').val();
    Rdisp = Rdisp ? Rdisp.split(/(,| )[ ]*/) : [];
    RAMdisplay = [];
    
    for(var i=0; i<Rdisp.length; i++){
        var dash = Rdisp[i].indexOf("-");
        if(dash > -1){
            var nums = Rdisp[i].split("-").map(Number);
            for(var j=nums[0]; j<=nums[1]; j++){ RAMdisplay.push(j); }
        } else {
            var num = Number(Rdisp[i]);
            if(num || Rdisp[i]==="0"){ RAMdisplay.push(num); }
        }
    }
    
    set_display();
}

function set_display(){
    svg = d3.select('#display');
    svg.selectAll('g').remove();
    svg.attr('height',RAMdisplay.length*20);
    
    max = 0;
    for(var i=0; i<RAMdisplay.length; i++){if(RAMdisplay[i] > max){max = RAMdisplay[i]}}
    var offset = 12+8*max.toString().length;
    svg.attr('width',16*20 + offset);
    console.log("offset: "+offset);
    
    for(var i=0; i<RAMdisplay.length; i++){
        var addr = RAMdisplay[i];
        var row = svg.append('g').attr('class', 'row'+addr).attr('transform','translate(0,'+(i*20)+')');
        row.append('text')
          .text(addr)
          .attr('x',5)
          .attr('y',15);
        
        var val = addr < RAM.length ? RAM[addr][0] : 0;
        for(var j=0; j<16; j++){
            row.append('rect')
              .attr('class','rect'+j)
              .attr('fill',val & (1<<j) ? '#000' : '#FFF')
              .attr('x',offset+j*20)
              .attr('y',0)
              .attr('width',20)
              .attr('height',20)
              .attr('stroke','#808080')
              .attr('stroke-width','1px');
        }
    }
}

function update_display(addr){
    var k = RAMdisplay.indexOf(addr);
    var val = addr < RAM.length ? RAM[addr][0] : 0;
    var row = d3.select('#display g.row'+addr);
    
    for(var j=0; j<16; j++){
        row.select('.rect'+j)
          .attr('fill',val & (1 << (15-j)) ? '#000' : '#FFF');
    }
}

function null_bus(_) {
    this.buffer = [];

    this.write = function(_) { return 0; };
    this.init = function() {};
    this.close = function() {};
}

function console_bus(control) {
    this.cooked = true;
    this.output = $("<textarea/>", {style: "width: 100%;", readonly: true});

    this.input = $("<input/>", {style: "width: 100%;", type: "text", keypress: function(event) {
        if (!this.cooked) {
            this.buffer.push(event.keyCode);

            if (!this.prev_input) {
                this.output.append("\n< ");
            }

            this.output.append(String.fromCharCode(event.keyCode));
            this.prev_input = true;

            return false;
        } else if (event.keyCode === 13) {
            var input = this.input.val();
            console.log(input);

            for (var i = 0; i < input.length; i++) {
                this.buffer.push(input.charCodeAt(i));
            }

            this.buffer.push(13);

            if (!this.prev_input) {
                this.output.append("\n< ");
            }

            this.output.append(input);
            this.output.append("\n");

            this.input.val("");
            this.prev_input = true;

            return false;
        } else {
            return true;
        }
    }.bind(this)});

    this.write = function(val) {
        if (this.prev_input || this.prev_input === null) {
            this.output.append("\n> ");
            this.prev_input = false;
        }

        this.output.append(val);

        return 1;
    };

    this.init = this.close = function() {
        this.buffer = [];
        this.prev_input = null;
        this.output.append("---");
    };

    control.append(this.output);
    control.append(this.input);

    this.cook_control = $("<input>", {type: "checkbox", click: function() { 
        this.cooked = this.cook_control.is(':checked');
    }.bind(this)});

    control.append(this.cook_control);
    control.append("Cooked?")
}

function websocket_bus(control) {
    this.ws = null;

    this.ws_host = $("<input/>", {style: "width: 100%;", type: "text", placeholder: "wss://host:port"});

    this.init = function() {
        this.buffer = [];
        this.send_buffer = [];

        ws_host = this.ws_host.val();

        if (ws_host) {
            this.ws = new WebSocket(ws_host);

            this.ws.onopen = function(_) {
                this.send_buffer.forEach(this.ws.send);
            }.bind(this);

            this.ws.onmessage = function(msg) {
                for (var i = 0; i < msg.data.length; i++) {
                    this.buffer.push(msg.data.charCodeAt(i));
                }
            }.bind(this);
        }
    };

    this.close = function() {
        if (this.ws) {
            this.ws.close();
        }
    };

    this.write = function(val) {
        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(val);
            } else {
                this.send_buffer.push(val);
            }

            return 1;
        }

        return 0;
    };

    control.append(this.ws_host);
}

var bus_classes = [
    ["Disabled", "null_bus"],
    ["Console", "console_bus"],
    ["WebSocket", "websocket_bus"],
];

function add_bus() {
    var row = $("<tr/>");
    var display = $("<div/>");

    var bus_ref = "busses[" + busses.length + "]";
    busses[busses.length] = [new null_bus(), display];

    bus_classes.forEach(function(klass, i) {
        var radio_button = $("<input type=radio name=bus" + busses.length
                           + " onchange=\""
                           + bus_ref + "[0].close();"
                           + bus_ref + "[1].empty();"
                           + bus_ref + "[0] = new " + klass[1] + "(" + bus_ref + "[1]);\">"
                           + klass[0]
                           + "</input>");

        if (i === 0) radio_button.prop("checked", true);

        row.append(radio_button);
    });

    row.append($("<br/>"))
    row.append(display);

    $("#busses").append(row);
}
