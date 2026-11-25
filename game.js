/* ===================================================================
   1. GAME ENGINE CONSTANTS & GLOBALS (1.3x LARGER MAP)
   =================================================================== */
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 450;
const TILE_SIZE = 20; // 20px per tile block
const WORLD_TILES_X = 234; // 1.3x Larger (4680px wide)
const WORLD_TILES_Y = 30;  // 600px tall
const WORLD_WIDTH = WORLD_TILES_X * TILE_SIZE; // 4680px
const WORLD_HEIGHT = WORLD_TILES_Y * TILE_SIZE; // 600px
const MAX_REACH_DIST = 110; // Max mining/building reach in pixels

// Canvas & Context Setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const miniCtx = minimapCanvas.getContext('2d');

// Disable context menu on right-click for block building
canvas.oncontextmenu = (e) => e.preventDefault();

// Disable smoothing for sharp pixel rendering
ctx.imageSmoothingEnabled = false;
miniCtx.imageSmoothingEnabled = false;

/* Web Audio API Synthesizer Sound Generator */
class RetroAudio {
    constructor() {
        this.ctx = null;
    }
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }
    playTone(freq, type, duration, vol = 0.1) {
        if (!this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch(e) {}
    }
    playJump() {
        if (!this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(160, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(480, this.ctx.currentTime + 0.14);
            gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.14);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.14);
        } catch(e) {}
    }
    playBite() {
        this.playTone(120, 'sawtooth', 0.12, 0.15);
    }
    playMine() {
        this.playTone(90, 'triangle', 0.08, 0.18);
        setTimeout(() => this.playTone(180, 'noise', 0.05, 0.1), 30);
    }
    playPlace() {
        this.playTone(220, 'sine', 0.06, 0.12);
    }
    playDna() {
        this.playTone(600, 'sine', 0.08, 0.1);
        setTimeout(() => this.playTone(900, 'sine', 0.12, 0.1), 60);
    }
    playExplosion() {
        this.playTone(60, 'sawtooth', 0.6, 0.25);
    }
}
const audio = new RetroAudio();

// Evolution & Upgrade System State
const upgrades = {
    bite: { lvl: 0, cost: 20 },
    speed: { lvl: 0, cost: 15 },
    jump: { lvl: 0, cost: 15 },
    time: { lvl: 0, cost: 25 }
};

// Player Inventory for Building
const playerInv = {
    dirt: 15,
    stone: 10
};

let generation = 1;
let totalDna = 0;
let currentRunDna = 0;
let timerMax = 30.0;
let timerRemaining = 30.0;
let gameState = 'START'; // 'START', 'PLAYING', 'EXTINCTION', 'EVO_SHOP'
let lastTime = 0;

// Mouse State
const mouse = {
    x: 0,
    y: 0,
    worldX: 0,
    worldY: 0,
    tileX: 0,
    tileY: 0,
    downLeft: false,
    downRight: false,
    inReach: false
};

// Camera object with Lerp / Smooth Following
const camera = {
    x: 0,
    y: 0,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    update(targetX, targetY) {
        const targetCamX = targetX - this.width / 2;
        const targetCamY = targetY - this.height / 2;
        
        this.x += (targetCamX - this.x) * 0.12;
        this.y += (targetCamY - this.y) * 0.12;

        this.x = Math.max(0, Math.min(WORLD_WIDTH - this.width, this.x));
        this.y = Math.max(0, Math.min(WORLD_HEIGHT - this.height, this.y));
    }
};

// Inputs State
const keys = {
    left: false,
    right: false,
    jump: false,
    sprint: false,
    bite: false
};

// Tilemap Enum Types
const TILE = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    CAVE_AIR: 4
};

let worldMap = []; 
let floraList = []; 
let dnaPickups = []; 
let preyList = [];  
let therizinoList = []; // Therizinosaurus entities
let carnoList = [];     // Carnotaurus entities
let particleList = []; 

// Smoother heightmap & small cave holes generation
function generateWorld() {
    worldMap = Array(WORLD_TILES_Y).fill(0).map(() => Array(WORLD_TILES_X).fill(TILE.AIR));
    floraList = [];
    dnaPickups = [];
    preyList = [];
    therizinoList = [];
    carnoList = [];

    // Heightmap terrain generation with reduced deep dips for easier navigation
    for (let x = 0; x < WORLD_TILES_X; x++) {
        const baseHeight = 16; 
        const hillOffset = Math.floor(
            Math.sin(x * 0.05) * 2 + 
            Math.cos(x * 0.1) * 1.5
        );
        const surfaceY = Math.max(10, Math.min(WORLD_TILES_Y - 5, baseHeight + hillOffset));

        for (let y = surfaceY; y < WORLD_TILES_Y; y++) {
            if (y === surfaceY) {
                worldMap[y][x] = TILE.GRASS;
                if (x % 6 === 0 || Math.random() < 0.18) {
                    floraList.push({
                        x: x * TILE_SIZE,
                        y: (y - 1) * TILE_SIZE,
                        type: Math.random() < 0.5 ? 'FERN' : 'CYCAD'
                    });
                }
            } else if (y < surfaceY + 5) {
                worldMap[y][x] = TILE.DIRT;
            } else {
                worldMap[y][x] = TILE.STONE;
            }
        }
    }

    // Carve underground caverns WITH SMALLER HOLES (only deep underground)
    for (let x = 12; x < WORLD_TILES_X - 12; x++) {
        for (let y = 20; y < WORLD_TILES_Y - 2; y++) {
            const noise = Math.sin(x * 0.25) * Math.cos(y * 0.35);
            if (noise > 0.45) { // Tighter threshold = smaller pit holes
                worldMap[y][x] = TILE.CAVE_AIR;
            }
        }
    }

    // Spawn DNA Fossils
    for (let i = 0; i < 45; i++) {
        const rx = Math.floor(Math.random() * (WORLD_TILES_X - 10)) + 5;
        let ry = 0;
        for (let y = 0; y < WORLD_TILES_Y; y++) {
            if (worldMap[y][rx] !== TILE.AIR) {
                ry = y - 1;
                break;
            }
        }
        if (Math.random() < 0.3) {
            ry = Math.floor(Math.random() * 6) + 20;
        }
        dnaPickups.push({
            x: rx * TILE_SIZE + 4,
            y: ry * TILE_SIZE + 4,
            width: 12,
            height: 12,
            collected: false,
            val: Math.floor(Math.random() * 5) + 5
        });
    }

    // Spawn Small Prey
    for (let i = 0; i < 20; i++) {
        const px = Math.floor(Math.random() * (WORLD_TILES_X - 20) + 10) * TILE_SIZE;
        preyList.push(new Prey(px, 100, Math.random() < 0.5 ? 'LIZARD' : 'MAMMOTH_RAT'));
    }

    // Spawn Therizinosaurus (2 instances)
    for (let i = 0; i < 2; i++) {
        const tx = Math.floor(Math.random() * (WORLD_TILES_X - 40) + 20) * TILE_SIZE;
        therizinoList.push(new Therizinosaurus(tx, 100));
    }

    // Spawn Carnotaurus (3 instances)
    for (let i = 0; i < 3; i++) {
        const cx = Math.floor(Math.random() * (WORLD_TILES_X - 40) + 20) * TILE_SIZE;
        carnoList.push(new Carnotaurus(cx, 100));
    }
}

/* ===================================================================
   2. UTAHRAPTOR PLAYER CLASS
   =================================================================== */
class Utahraptor {
    constructor() {
        this.width = 36;
        this.height = 24;
        this.x = 200;
        this.y = 100;
        this.vx = 0;
        this.vy = 0;
        this.grounded = false;
        this.facing = 1; 
        this.animFrame = 0;
        this.animTimer = 0;
        
        this.coyoteTimer = 0;    
        this.jumpBufferTimer = 0; 
        this.isSprinting = false;

        this.maxHp = 100;
        this.hp = 100;
        this.isAttacking = false;
        this.attackTimer = 0;
        this.attackCooldown = 0;

        this.moveSpeed = 4.0 + (upgrades.speed.lvl * 0.6);
        this.jumpPower = -9.2 - (upgrades.jump.lvl * 0.9);
        this.biteDamage = 35 + (upgrades.bite.lvl * 15);
    }

    reset() {
        this.x = 200;
        this.y = 100;
        this.vx = 0;
        this.vy = 0;
        this.hp = this.maxHp;
        this.coyoteTimer = 0;
        this.jumpBufferTimer = 0;
        this.moveSpeed = 4.0 + (upgrades.speed.lvl * 0.6);
        this.jumpPower = -9.2 - (upgrades.jump.lvl * 0.9);
        this.biteDamage = 35 + (upgrades.bite.lvl * 15);
    }

    update(dt) {
        this.hp = Math.max(0, this.hp - dt * 1.2);

        if (this.grounded) {
            this.coyoteTimer = 0.12; 
        } else {
            this.coyoteTimer -= dt;
        }

        if (keys.jump) {
            this.jumpBufferTimer = 0.12; 
        } else {
            this.jumpBufferTimer -= dt;
        }

        this.isSprinting = keys.sprint;
        const currentMaxSpeed = this.moveSpeed * (this.isSprinting ? 1.45 : 1.0);
        const accel = this.grounded ? 0.25 : 0.15; 

        if (keys.left) {
            this.vx += (-currentMaxSpeed - this.vx) * accel;
            this.facing = -1;
        } else if (keys.right) {
            this.vx += (currentMaxSpeed - this.vx) * accel;
            this.facing = 1;
        } else {
            this.vx *= this.grounded ? 0.72 : 0.92; 
        }

        if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
            this.vy = this.jumpPower;
            this.grounded = false;
            this.coyoteTimer = 0;
            this.jumpBufferTimer = 0;
            audio.playJump();

            for (let i = 0; i < 5; i++) {
                particleList.push(new Particle(
                    this.x + this.width/2, this.y + this.height,
                    (Math.random() - 0.5) * 3, Math.random() * 2,
                    '#94a3b8', 10
                ));
            }
        }

        if (!keys.jump && this.vy < -3) {
            this.vy *= 0.5;
        }

        this.vy += 0.48;

        if (this.attackCooldown > 0) this.attackCooldown -= dt;
        if (keys.bite && this.attackCooldown <= 0) {
            this.isAttacking = true;
            this.attackTimer = 0.2;
            this.attackCooldown = 0.35;
            audio.playBite();
            this.performBiteAttack();
        }

        if (this.isAttacking) {
            this.attackTimer -= dt;
            if (this.attackTimer <= 0) this.isAttacking = false;
        }

        this.moveAndCollide();

        if (Math.abs(this.vx) > 0.5) {
            this.animTimer += dt * (this.isSprinting ? 18 : 12);
            this.animFrame = Math.floor(this.animTimer) % 4;
        } else {
            this.animFrame = 0;
        }
    }

    performBiteAttack() {
        const biteX = this.facing === 1 ? this.x + this.width : this.x - 24;
        const biteY = this.y;
        const biteW = 28;
        const biteH = this.height;

        for (let i = 0; i < 6; i++) {
            particleList.push(new Particle(
                biteX + biteW / 2, biteY + biteH / 2, 
                (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, 
                '#38bdf8', 12
            ));
        }

        // Bite Small Prey
        preyList.forEach(prey => {
            if (prey.alive &&
                biteX < prey.x + prey.width &&
                biteX + biteW > prey.x &&
                biteY < prey.y + prey.height &&
                biteY + biteH > prey.y) {
                
                prey.takeDamage(this.biteDamage);
                if (!prey.alive) {
                    const hpGain = prey.type === 'LIZARD' ? 20 : 35;
                    const dnaGain = (prey.type === 'LIZARD' ? 8 : 15) * (1 + upgrades.bite.lvl * 0.25);
                    this.hp = Math.min(this.maxHp, this.hp + hpGain);
                    currentRunDna += Math.floor(dnaGain);
                    totalDna += Math.floor(dnaGain);
                    showBanner(`Prey Consumed! +${hpGain} Hunger | +${Math.floor(dnaGain)} DNA`);
                }
            }
        });

        // Bite Therizinosaurus (Provokes it!)
        therizinoList.forEach(th => {
            if (th.alive &&
                biteX < th.x + th.width &&
                biteX + biteW > th.x &&
                biteY < th.y + th.height &&
                biteY + biteH > th.y) {
                
                th.takeDamage(this.biteDamage);
                th.isAgitated = true; // Agitates the neutral giant!
                if (!th.alive) {
                    this.hp = Math.min(this.maxHp, this.hp + 50);
                    totalDna += 80;
                    showBanner(`Therizinosaurus Slain! +50 Hunger | +80 DNA!`);
                } else {
                    showBanner(`Therizinosaurus Provoked! It is counter-attacking!`);
                }
            }
        });

        // Bite Carnotaurus
        carnoList.forEach(cn => {
            if (cn.alive &&
                biteX < cn.x + cn.width &&
                biteX + biteW > cn.x &&
                biteY < cn.y + cn.height &&
                biteY + biteH > cn.y) {
                
                cn.takeDamage(this.biteDamage);
                if (!cn.alive) {
                    this.hp = Math.min(this.maxHp, this.hp + 35);
                    totalDna += 50;
                    showBanner(`Carnotaurus Defeated! +35 Hunger | +50 DNA!`);
                }
            }
        });
    }

    moveAndCollide() {
        this.x += this.vx;
        let bounds = this.getTileBounds();
        for (let y = bounds.top; y <= bounds.bottom; y++) {
            for (let x = bounds.left; x <= bounds.right; x++) {
                if (isSolidTile(x, y)) {
                    if (this.vx > 0) this.x = x * TILE_SIZE - this.width;
                    else if (this.vx < 0) this.x = (x + 1) * TILE_SIZE;
                    this.vx = 0;
                }
            }
        }

        this.y += this.vy;
        this.grounded = false;
        bounds = this.getTileBounds();
        for (let y = bounds.top; y <= bounds.bottom; y++) {
            for (let x = bounds.left; x <= bounds.right; x++) {
                if (isSolidTile(x, y)) {
                    if (this.vy > 0) {
                        this.y = y * TILE_SIZE - this.height;
                        this.vy = 0;
                        this.grounded = true;
                    } else if (this.vy < 0) {
                        this.y = (y + 1) * TILE_SIZE;
                        this.vy = 0;
                    }
                }
            }
        }

        this.x = Math.max(0, Math.min(WORLD_WIDTH - this.width, this.x));
        if (this.y > WORLD_HEIGHT) {
            this.hp = 0; 
        }
    }

    getTileBounds() {
        return {
            left: Math.floor(this.x / TILE_SIZE),
            right: Math.floor((this.x + this.width - 1) / TILE_SIZE),
            top: Math.floor(this.y / TILE_SIZE),
            bottom: Math.floor((this.y + this.height - 1) / TILE_SIZE)
        };
    }

    draw(ctx, cam) {
        const screenX = this.x - cam.x;
        const screenY = this.y - cam.y;

        ctx.save();
        ctx.translate(screenX + this.width / 2, screenY + this.height / 2);
        if (this.facing === -1) ctx.scale(-1, 1);

        const cBody = '#3b3355';
        const cBelly = '#d4a237';
        const cFeather = '#1c73cf';
        const cCyan = '#2ca2e6';
        const cClaw = '#f59e0b';

        const legOffset = Math.sin(this.animTimer * 1.2) * (this.isSprinting ? 6 : 4);

        ctx.fillStyle = cFeather;
        ctx.beginPath();
        ctx.moveTo(-10, -2);
        ctx.lineTo(-28, -6 + Math.sin(this.animTimer) * 2);
        ctx.lineTo(-26, 2);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = cCyan;
        ctx.fillRect(-26, -4, 12, 4);

        ctx.fillStyle = '#2a2340';
        ctx.fillRect(-6 + legOffset, 6, 5, 10);
        ctx.fillStyle = cClaw;
        ctx.fillRect(-4 + legOffset, 14, 4, 3);

        ctx.fillStyle = cBody;
        ctx.fillRect(-12, -8, 22, 14);

        ctx.fillStyle = cBelly;
        ctx.fillRect(-4, 0, 12, 5);

        ctx.fillStyle = cBody;
        ctx.fillRect(4, -14, 12, 12);
        ctx.fillRect(10, -12, 10, 8);

        ctx.fillStyle = '#fef08a';
        ctx.fillRect(10, -11, 2, 2);

        if (this.isAttacking) {
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(12, -6, 8, 4);
            ctx.fillStyle = cBody;
            ctx.fillRect(10, -2, 10, 4);
        }

        ctx.fillStyle = cCyan;
        ctx.fillRect(0, -2, 10, 6);
        ctx.fillStyle = cFeather;
        ctx.fillRect(4, 2, 8, 4);
        ctx.fillStyle = cClaw;
        ctx.fillRect(10, 2, 3, 3);

        ctx.fillStyle = cBody;
        ctx.fillRect(-2 - legOffset, 6, 5, 10);
        ctx.fillStyle = cClaw;
        ctx.fillRect(0 - legOffset, 14, 5, 3);

        ctx.restore();
    }
}

/* ===================================================================
   3. NEW MOBS & PREY CLASSES (THERIZINOSAURUS & CARNOTAURUS)
   =================================================================== */
class Prey {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.width = type === 'LIZARD' ? 18 : 22;
        this.height = type === 'LIZARD' ? 10 : 14;
        this.vx = (Math.random() - 0.5) * 2;
        this.vy = 0;
        this.hp = type === 'LIZARD' ? 20 : 45;
        this.alive = true;
        this.facing = 1;
        this.changeDirTimer = 0;
    }

    takeDamage(dmg) {
        this.hp -= dmg;
        if (this.hp <= 0) this.alive = false;
    }

    update(dt, playerX) {
        if (!this.alive) return;

        const distToPlayer = playerX - this.x;
        if (Math.abs(distToPlayer) < 140) {
            this.vx = distToPlayer > 0 ? -2.2 : 2.2;
        } else {
            this.changeDirTimer -= dt;
            if (this.changeDirTimer <= 0) {
                this.vx = (Math.random() - 0.5) * 1.5;
                this.changeDirTimer = Math.random() * 3 + 1;
            }
        }

        this.facing = this.vx >= 0 ? 1 : -1;
        this.vy += 0.4;

        this.x += this.vx;
        if (isSolidTile(Math.floor((this.x + (this.vx > 0 ? this.width : 0)) / TILE_SIZE), Math.floor(this.y / TILE_SIZE))) {
            this.x -= this.vx;
            this.vx = -this.vx;
        }

        this.y += this.vy;
        const tileY = Math.floor((this.y + this.height) / TILE_SIZE);
        const tileX = Math.floor((this.x + this.width / 2) / TILE_SIZE);
        if (isSolidTile(tileX, tileY)) {
            this.y = (tileY * TILE_SIZE) - this.height;
            this.vy = 0;
        }
    }

    draw(ctx, cam) {
        if (!this.alive) return;
        const screenX = this.x - cam.x;
        const screenY = this.y - cam.y;

        ctx.save();
        ctx.translate(screenX + this.width / 2, screenY + this.height / 2);
        if (this.facing === -1) ctx.scale(-1, 1);

        if (this.type === 'LIZARD') {
            ctx.fillStyle = '#22c55e';
            ctx.fillRect(-8, -3, 14, 6);
            ctx.fillStyle = '#15803d';
            ctx.fillRect(4, -4, 5, 4);
            ctx.fillRect(-12, -1, 5, 2);
        } else {
            ctx.fillStyle = '#a16207';
            ctx.fillRect(-9, -5, 16, 10);
            ctx.fillStyle = '#78350f';
            ctx.fillRect(5, -6, 6, 6);
            ctx.fillStyle = '#fef08a';
            ctx.fillRect(7, -5, 2, 2);
        }

        ctx.restore();
    }
}

/* --- THERIZINOSAURUS (1.5x Utahraptor, 300 HP, Neutral, Long Claws) --- */
class Therizinosaurus {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 54;  // 1.5x Utahraptor (36 * 1.5)
        this.height = 36; // 1.5x Utahraptor (24 * 1.5)
        this.vx = 0;
        this.vy = 0;
        this.maxHp = 300;
        this.hp = 300;
        this.alive = true;
        this.facing = 1;
        this.isAgitated = false; // Neutral: only attacks back if attacked
        this.color = Math.random() < 0.5 ? '#4b5563' : '#451a03'; // Gray or Dark Brown
        this.attackCooldown = 0;
        this.reach = 55; // Long claws reach
        this.clawDamage = 30;
        this.changeDirTimer = 0;
    }

    takeDamage(dmg) {
        this.hp -= dmg;
        this.isAgitated = true;
        if (this.hp <= 0) this.alive = false;
    }

    update(dt, player) {
        if (!this.alive) return;

        if (this.attackCooldown > 0) this.attackCooldown -= dt;

        const distToPlayer = (player.x + player.width/2) - (this.x + this.width/2);

        if (this.isAgitated) {
            // Chase player when agitated
            if (Math.abs(distToPlayer) > 10) {
                this.vx = distToPlayer > 0 ? 2.2 : -2.2;
            }
            // Attack player with huge claws
            if (Math.abs(distToPlayer) < this.reach && this.attackCooldown <= 0) {
                player.hp -= this.clawDamage;
                this.attackCooldown = 1.2;
                for (let i = 0; i < 8; i++) {
                    particleList.push(new Particle(
                        player.x + player.width/2, player.y + player.height/2,
                        (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5,
                        '#e11d48', 15
                    ));
                }
            }
        } else {
            // Calmly wander around
            this.changeDirTimer -= dt;
            if (this.changeDirTimer <= 0) {
                this.vx = (Math.random() - 0.5) * 1.2;
                this.changeDirTimer = Math.random() * 4 + 2;
            }
        }

        this.facing = this.vx >= 0 ? 1 : -1;
        this.vy += 0.4;

        this.x += this.vx;
        if (isSolidTile(Math.floor((this.x + (this.vx > 0 ? this.width : 0)) / TILE_SIZE), Math.floor(this.y / TILE_SIZE))) {
            this.x -= this.vx;
            this.vx = -this.vx;
        }

        this.y += this.vy;
        const tileY = Math.floor((this.y + this.height) / TILE_SIZE);
        const tileX = Math.floor((this.x + this.width / 2) / TILE_SIZE);
        if (isSolidTile(tileX, tileY)) {
            this.y = (tileY * TILE_SIZE) - this.height;
            this.vy = 0;
        }
    }

    draw(ctx, cam) {
        if (!this.alive) return;
        const screenX = this.x - cam.x;
        const screenY = this.y - cam.y;

        ctx.save();
        ctx.translate(screenX + this.width / 2, screenY + this.height / 2);
        if (this.facing === -1) ctx.scale(-1, 1);

        // Body
        ctx.fillStyle = this.color;
        ctx.fillRect(-18, -12, 36, 22);

        // Tall Neck & Small Head
        ctx.fillRect(8, -22, 12, 16);
        ctx.fillRect(14, -24, 10, 8);

        // Eye (Red if agitated, yellow if calm)
        ctx.fillStyle = this.isAgitated ? '#ef4444' : '#fef08a';
        ctx.fillRect(18, -22, 3, 3);

        // Giant Long Claws (Distinctive Feature!)
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.moveTo(10, -2);
        ctx.lineTo(26, 4);
        ctx.lineTo(24, 8);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(10, 2);
        ctx.lineTo(28, 10);
        ctx.lineTo(26, 14);
        ctx.closePath();
        ctx.fill();

        // Legs
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(-10, 10, 8, 10);
        ctx.fillRect(4, 10, 8, 10);

        // Health Bar above head
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(-20, -32, 40, 5);
        ctx.fillStyle = this.isAgitated ? '#ef4444' : '#10b981';
        ctx.fillRect(-20, -32, (this.hp / this.maxHp) * 40, 5);

        ctx.restore();
    }
}

/* --- CARNOTAURUS (1.3x Utahraptor, Aggressive, Hunts Small Prey & Player) --- */
class Carnotaurus {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 47;  // 1.3x Utahraptor (36 * 1.3)
        this.height = 31; // 1.3x Utahraptor (24 * 1.3)
        this.vx = 0;
        this.vy = 0;
        this.maxHp = 120;
        this.hp = 120;
        this.alive = true;
        this.facing = 1;
        this.color = Math.random() < 0.5 ? '#881337' : '#14532d'; // Dark Red or Dark Green
        this.attackCooldown = 0;
        this.biteDamage = 20;
        this.changeDirTimer = 0;
    }

    takeDamage(dmg) {
        this.hp -= dmg;
        if (this.hp <= 0) this.alive = false;
    }

    update(dt, player, preyList) {
        if (!this.alive) return;

        if (this.attackCooldown > 0) this.attackCooldown -= dt;

        const distToPlayer = (player.x + player.width/2) - (this.x + this.width/2);

        // Look for nearby small prey to hunt!
        let targetPrey = null;
        let minDist = 180;
        preyList.forEach(pr => {
            if (pr.alive) {
                const d = Math.abs((pr.x + pr.width/2) - (this.x + this.width/2));
                if (d < minDist) {
                    minDist = d;
                    targetPrey = pr;
                }
            }
        });

        if (targetPrey) {
            // Hunt Small Prey (prey < Carnotaurus)
            const d = (targetPrey.x + targetPrey.width/2) - (this.x + this.width/2);
            this.vx = d > 0 ? 2.5 : -2.5;

            // Devour prey
            if (Math.abs(d) < 25 && this.attackCooldown <= 0) {
                targetPrey.takeDamage(100);
                this.hp = Math.min(this.maxHp, this.hp + 20);
                this.attackCooldown = 0.8;
            }
        } else if (Math.abs(distToPlayer) < 160) {
            // Aggressive towards Player if nearby
            this.vx = distToPlayer > 0 ? 2.4 : -2.4;

            if (Math.abs(distToPlayer) < 30 && this.attackCooldown <= 0) {
                player.hp -= this.biteDamage;
                this.attackCooldown = 1.0;
                for (let i = 0; i < 6; i++) {
                    particleList.push(new Particle(
                        player.x + player.width/2, player.y + player.height/2,
                        (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4,
                        '#ef4444', 12
                    ));
                }
            }
        } else {
            // Wander
            this.changeDirTimer -= dt;
            if (this.changeDirTimer <= 0) {
                this.vx = (Math.random() - 0.5) * 1.8;
                this.changeDirTimer = Math.random() * 3 + 1;
            }
        }

        this.facing = this.vx >= 0 ? 1 : -1;
        this.vy += 0.4;

        this.x += this.vx;
        if (isSolidTile(Math.floor((this.x + (this.vx > 0 ? this.width : 0)) / TILE_SIZE), Math.floor(this.y / TILE_SIZE))) {
            this.x -= this.vx;
            this.vx = -this.vx;
        }

        this.y += this.vy;
        const tileY = Math.floor((this.y + this.height) / TILE_SIZE);
        const tileX = Math.floor((this.x + this.width / 2) / TILE_SIZE);
        if (isSolidTile(tileX, tileY)) {
            this.y = (tileY * TILE_SIZE) - this.height;
            this.vy = 0;
        }
    }

    draw(ctx, cam) {
        if (!this.alive) return;
        const screenX = this.x - cam.x;
        const screenY = this.y - cam.y;

        ctx.save();
        ctx.translate(screenX + this.width / 2, screenY + this.height / 2);
        if (this.facing === -1) ctx.scale(-1, 1);

        // Body
        ctx.fillStyle = this.color;
        ctx.fillRect(-16, -10, 32, 20);

        // Head with Distinctive Horns above eyes!
        ctx.fillRect(8, -16, 12, 14);
        ctx.fillStyle = '#fef08a'; // Brow Horns
        ctx.fillRect(12, -19, 4, 4);

        // Eye
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(14, -13, 3, 3);

        // Tiny Vestigial Arms
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(2, 2, 3, 4);

        // Legs
        ctx.fillRect(-10, 10, 6, 8);
        ctx.fillRect(2, 10, 6, 8);

        // Health Bar above head
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(-15, -24, 30, 4);
        ctx.fillStyle = '#f97316';
        ctx.fillRect(-15, -24, (this.hp / this.maxHp) * 30, 4);

        ctx.restore();
    }
}

class Particle {
    constructor(x, y, vx, vy, color, life) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.life = life;
        this.maxLife = life;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life--;
    }
    draw(ctx, cam) {
        ctx.fillStyle = this.color;
        ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
        ctx.fillRect(this.x - cam.x, this.y - cam.y, 3, 3);
        ctx.globalAlpha = 1.0;
    }
}

function isSolidTile(tx, ty) {
    if (tx < 0 || tx >= WORLD_TILES_X || ty < 0 || ty >= WORLD_TILES_Y) return true;
    const tile = worldMap[ty][tx];
    return tile === TILE.GRASS || tile === TILE.DIRT || tile === TILE.STONE;
}

/* ===================================================================
   4. MINING & BUILDING DIG/PLACE SYSTEM
   =================================================================== */
function handleMiningAndBuilding(player) {
    const playerCenterX = player.x + player.width / 2;
    const playerCenterY = player.y + player.height / 2;
    const targetCenterX = mouse.tileX * TILE_SIZE + TILE_SIZE / 2;
    const targetCenterY = mouse.tileY * TILE_SIZE + TILE_SIZE / 2;

    const dist = Math.hypot(targetCenterX - playerCenterX, targetCenterY - playerCenterY);
    mouse.inReach = dist <= MAX_REACH_DIST;

    if (!mouse.inReach) return;

    const tx = mouse.tileX;
    const ty = mouse.tileY;

    if (tx < 0 || tx >= WORLD_TILES_X || ty < 0 || ty >= WORLD_TILES_Y) return;

    const currentTile = worldMap[ty][tx];

    // Left Click: Dig / Mine Block
    if (mouse.downLeft) {
        if (currentTile !== TILE.AIR && currentTile !== TILE.CAVE_AIR) {
            if (currentTile === TILE.DIRT || currentTile === TILE.GRASS) playerInv.dirt++;
            else if (currentTile === TILE.STONE) playerInv.stone++;

            worldMap[ty][tx] = ty > 19 ? TILE.CAVE_AIR : TILE.AIR;
            audio.playMine();

            const pColor = currentTile === TILE.GRASS ? '#15803d' : (currentTile === TILE.DIRT ? '#78350f' : '#334155');
            for (let i = 0; i < 8; i++) {
                particleList.push(new Particle(
                    targetCenterX, targetCenterY,
                    (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5,
                    pColor, 15
                ));
            }
            mouse.downLeft = false; 
            updateInventoryUI();
        }
    }

    // Right Click: Place Block
    if (mouse.downRight) {
        if (currentTile === TILE.AIR || currentTile === TILE.CAVE_AIR) {
            const tileBox = { x: tx * TILE_SIZE, y: ty * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE };
            const playerBox = { x: player.x, y: player.y, w: player.width, h: player.height };

            const overlap = playerBox.x < tileBox.x + tileBox.w &&
                            playerBox.x + playerBox.w > tileBox.x &&
                            playerBox.y < tileBox.y + tileBox.h &&
                            playerBox.y + playerBox.h > tileBox.y;

            if (!overlap) {
                if (playerInv.dirt > 0) {
                    worldMap[ty][tx] = TILE.DIRT;
                    playerInv.dirt--;
                    audio.playPlace();
                    showPlacementParticles(targetCenterX, targetCenterY, '#78350f');
                } else if (playerInv.stone > 0) {
                    worldMap[ty][tx] = TILE.STONE;
                    playerInv.stone--;
                    audio.playPlace();
                    showPlacementParticles(targetCenterX, targetCenterY, '#334155');
                } else {
                    showBanner("No blocks left in inventory! Mine dirt/stone first.");
                }
                mouse.downRight = false;
                updateInventoryUI();
            }
        }
    }
}

function showPlacementParticles(cx, cy, color) {
    for (let i = 0; i < 6; i++) {
        particleList.push(new Particle(
            cx, cy,
            (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3,
            color, 12
        ));
    }
}

function updateInventoryUI() {
    document.getElementById('inv-dirt').innerText = playerInv.dirt;
    document.getElementById('inv-stone').innerText = playerInv.stone;
}

/* ===================================================================
   5. RENDERERS & ENVIRONMENT
   =================================================================== */
function drawParallaxBackground(ctx, cam) {
    const dangerRatio = 1 - (timerRemaining / timerMax);
    const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    
    if (dangerRatio > 0.7) {
        skyGrad.addColorStop(0, '#450a0a');
        skyGrad.addColorStop(1, '#9a3412');
    } else {
        skyGrad.addColorStop(0, '#0f172a');
        skyGrad.addColorStop(0.6, '#1e293b');
        skyGrad.addColorStop(1, '#334155');
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_HEIGHT);
    for (let x = 0; x <= CANVAS_WIDTH; x += 40) {
        const worldX = x + cam.x * 0.1;
        const mountainH = Math.sin(worldX * 0.005) * 80 + 180;
        ctx.lineTo(x, CANVAS_HEIGHT - mountainH);
    }
    ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.closePath();
    ctx.fill();

    if (dangerRatio > 0.5) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
        ctx.beginPath();
        ctx.arc(200 - cam.x * 0.1, 100, 40 + Math.sin(Date.now() * 0.003) * 10, 0, Math.PI * 2);
        ctx.arc(600 - cam.x * 0.1, 120, 50 + Math.cos(Date.now() * 0.003) * 10, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = '#064e3b';
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_HEIGHT);
    for (let x = 0; x <= CANVAS_WIDTH; x += 30) {
        const worldX = x + cam.x * 0.35;
        const forestH = Math.sin(worldX * 0.02) * 35 + 80;
        ctx.lineTo(x, CANVAS_HEIGHT - forestH);
    }
    ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.closePath();
    ctx.fill();
}

function drawWorldTiles(ctx, cam) {
    const startX = Math.max(0, Math.floor(cam.x / TILE_SIZE));
    const endX = Math.min(WORLD_TILES_X - 1, Math.ceil((cam.x + CANVAS_WIDTH) / TILE_SIZE));
    const startY = Math.max(0, Math.floor(cam.y / TILE_SIZE));
    const endY = Math.min(WORLD_TILES_Y - 1, Math.ceil((cam.y + CANVAS_HEIGHT) / TILE_SIZE));

    for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
            const tile = worldMap[y][x];
            const screenX = x * TILE_SIZE - cam.x;
            const screenY = y * TILE_SIZE - cam.y;

            if (tile === TILE.GRASS) {
                ctx.fillStyle = '#15803d';
                ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = '#22c55e';
                ctx.fillRect(screenX, screenY, TILE_SIZE, 4);
            } else if (tile === TILE.DIRT) {
                ctx.fillStyle = '#78350f';
                ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = '#451a03';
                ctx.fillRect(screenX + 4, screenY + 4, 3, 3);
            } else if (tile === TILE.STONE) {
                ctx.fillStyle = '#334155';
                ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = '#1e293b';
                ctx.fillRect(screenX + 2, screenY + 2, 8, 8);
            } else if (tile === TILE.CAVE_AIR) {
                ctx.fillStyle = '#090d16';
                ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
            }
        }
    }

    floraList.forEach(plant => {
        if (plant.x > cam.x - 40 && plant.x < cam.x + CANVAS_WIDTH + 40) {
            const px = plant.x - cam.x;
            const py = plant.y - cam.y;
            ctx.fillStyle = '#047857';
            ctx.fillRect(px + 8, py - 12, 4, 20);
            ctx.fillStyle = '#10b981';
            ctx.beginPath();
            ctx.arc(px + 10, py - 14, 12, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    dnaPickups.forEach(dna => {
        if (!dna.collected && dna.x > cam.x - 20 && dna.x < cam.x + CANVAS_WIDTH + 20) {
            const dx = dna.x - cam.x;
            const dy = dna.y - cam.y;
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(dx + 3, dy, 6, 12);
            ctx.fillRect(dx, dy + 3, 12, 6);
            ctx.fillStyle = '#e0f2fe';
            ctx.fillRect(dx + 4, dy + 4, 4, 4);
        }
    });
}

function drawMiningReticle(ctx, cam) {
    if (gameState !== 'PLAYING') return;

    const screenTileX = mouse.tileX * TILE_SIZE - cam.x;
    const screenTileY = mouse.tileY * TILE_SIZE - cam.y;

    ctx.save();
    ctx.lineWidth = 1.5;
    if (mouse.inReach) {
        ctx.strokeStyle = '#38bdf8'; 
        ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
    } else {
        ctx.strokeStyle = '#ef4444'; 
        ctx.fillStyle = 'rgba(239, 68, 68, 0.1)';
    }
    ctx.fillRect(screenTileX, screenTileY, TILE_SIZE, TILE_SIZE);
    ctx.strokeRect(screenTileX, screenTileY, TILE_SIZE, TILE_SIZE);
    ctx.restore();
}

function drawMinimap(player) {
    miniCtx.fillStyle = '#020617';
    miniCtx.fillRect(0, 0, 234, 30);

    const scaleX = 234 / WORLD_TILES_X;
    const scaleY = 30 / WORLD_TILES_Y;

    for (let x = 0; x < WORLD_TILES_X; x += 2) {
        for (let y = 0; y < WORLD_TILES_Y; y += 2) {
            const tile = worldMap[y][x];
            if (tile !== TILE.AIR && tile !== TILE.CAVE_AIR) {
                miniCtx.fillStyle = tile === TILE.GRASS ? '#22c55e' : '#475569';
                miniCtx.fillRect(x * scaleX, y * scaleY, 2, 2);
            }
        }
    }

    miniCtx.fillStyle = '#38bdf8';
    dnaPickups.forEach(dna => {
        if (!dna.collected) {
            miniCtx.fillRect((dna.x / TILE_SIZE) * scaleX, (dna.y / TILE_SIZE) * scaleY, 2, 2);
        }
    });

    miniCtx.fillStyle = '#f59e0b';
    miniCtx.fillRect((player.x / TILE_SIZE) * scaleX, (player.y / TILE_SIZE) * scaleY, 3, 3);
}

let bannerTimeout;
function showBanner(text) {
    const banner = document.getElementById('game-banner');
    const bannerText = document.getElementById('game-banner-text');
    bannerText.innerText = text;
    banner.classList.remove('opacity-0', '-translate-y-4');
    banner.classList.add('opacity-100', 'translate-y-0');
    
    clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => {
        banner.classList.remove('opacity-100', 'translate-y-0');
        banner.classList.add('opacity-0', '-translate-y-4');
    }, 2500);
}

/* ===================================================================
   6. GAME CONTROLLER & MAIN LOOP
   =================================================================== */
const player = new Utahraptor();

function startNewRun() {
    timerMax = 30.0 + (upgrades.time.lvl * 5.0);
    timerRemaining = timerMax;
    currentRunDna = 0;
    generateWorld();
    player.reset();
    gameState = 'PLAYING';

    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('evolution-modal').classList.add('hidden');
    document.getElementById('gen-count').innerText = `GEN ${generation}`;
    updateInventoryUI();
    showBanner(`Gen ${generation}! 1.3x Map Loaded. Watch out for Carnotaurus!`);
}

function triggerExtinction(reason) {
    gameState = 'EVO_SHOP';
    audio.playExplosion();

    document.getElementById('evo-reason').innerText = reason;
    document.getElementById('evo-dna-val').innerText = totalDna;
    
    ['bite', 'speed', 'jump', 'time'].forEach(key => {
        document.getElementById(`lvl-${key}`).innerText = `LVL ${upgrades[key].lvl}`;
        document.getElementById(`cost-${key}`).innerText = `${upgrades[key].cost} DNA`;
    });

    document.getElementById('evolution-modal').classList.remove('hidden');
}

function buyUpgrade(key) {
    audio.init();
    const up = upgrades[key];
    if (totalDna >= up.cost) {
        totalDna -= up.cost;
        up.lvl++;
        up.cost = Math.floor(up.cost * 1.5);
        audio.playDna();
        
        document.getElementById('evo-dna-val').innerText = totalDna;
        document.getElementById(`lvl-${key}`).innerText = `LVL ${up.lvl}`;
        document.getElementById(`cost-${key}`).innerText = `${up.cost} DNA`;
        document.getElementById('dna-count').innerText = totalDna;
    }
}

// Setup Event Listeners
document.getElementById('start-btn').addEventListener('click', () => { audio.init(); startNewRun(); });
document.getElementById('next-gen-btn').addEventListener('click', () => { generation++; startNewRun(); });
document.getElementById('buy-bite').addEventListener('click', () => buyUpgrade('bite'));
document.getElementById('buy-speed').addEventListener('click', () => buyUpgrade('speed'));
document.getElementById('buy-jump').addEventListener('click', () => buyUpgrade('jump'));
document.getElementById('buy-time').addEventListener('click', () => buyUpgrade('time'));

// Mouse Movement & Interaction Listeners
canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;

    mouse.x = (e.clientX - rect.left) * scaleX;
    mouse.y = (e.clientY - rect.top) * scaleY;

    mouse.worldX = mouse.x + camera.x;
    mouse.worldY = mouse.y + camera.y;

    mouse.tileX = Math.floor(mouse.worldX / TILE_SIZE);
    mouse.tileY = Math.floor(mouse.worldY / TILE_SIZE);
});

canvas.addEventListener('mousedown', e => {
    audio.init();
    if (e.button === 0) { // Left Click
        mouse.downLeft = true;
        keys.bite = true;
        setTimeout(() => keys.bite = false, 150);
    } else if (e.button === 2) { // Right Click
        mouse.downRight = true;
    }
});

canvas.addEventListener('mouseup', e => {
    if (e.button === 0) mouse.downLeft = false;
    if (e.button === 2) mouse.downRight = false;
});

// Keyboard Listeners
window.addEventListener('keydown', e => {
    audio.init();
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = true;
    if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'Space') keys.jump = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.sprint = true;
    if (e.code === 'KeyJ' || e.code === 'KeyE') keys.bite = true;
});

window.addEventListener('keyup', e => {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = false;
    if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'Space') keys.jump = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.sprint = false;
    if (e.code === 'KeyJ' || e.code === 'KeyE') keys.bite = false;
});

// Mobile Controls
const setupTouchBtn = (id, keyName) => {
    const btn = document.getElementById(id);
    const start = (e) => { e.preventDefault(); audio.init(); keys[keyName] = true; };
    const end = (e) => { e.preventDefault(); keys[keyName] = false; };
    btn.addEventListener('touchstart', start);
    btn.addEventListener('touchend', end);
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', end);
};
setupTouchBtn('btn-left', 'left');
setupTouchBtn('btn-right', 'right');
setupTouchBtn('btn-jump', 'jump');
setupTouchBtn('btn-bite', 'bite');

/* Main Game Loop */
function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dt = Math.min(0.1, (timestamp - lastTime) / 1000);
    lastTime = timestamp;

    if (gameState === 'PLAYING') {
        timerRemaining -= dt;
        if (timerRemaining <= 0) {
            timerRemaining = 0;
            triggerExtinction("METEOR IMPACT OCCURRED!");
        }

        if (player.hp <= 0) {
            triggerExtinction("KILLED / STARVED!");
        }

        player.update(dt);
        camera.update(player.x + player.width / 2, player.y + player.height / 2);

        handleMiningAndBuilding(player);

        preyList.forEach(prey => prey.update(dt, player.x));
        therizinoList.forEach(th => th.update(dt, player));
        carnoList.forEach(cn => cn.update(dt, player, preyList));

        dnaPickups.forEach(dna => {
            if (!dna.collected &&
                player.x < dna.x + dna.width &&
                player.x + player.width > dna.x &&
                player.y < dna.y + dna.height &&
                player.y + player.height > dna.y) {
                
                dna.collected = true;
                currentRunDna += dna.val;
                totalDna += dna.val;
                audio.playDna();
                showBanner(`+${dna.val} Ancient DNA Extracted!`);
            }
        });

        for (let i = particleList.length - 1; i >= 0; i--) {
            particleList[i].update();
            if (particleList[i].life <= 0) particleList.splice(i, 1);
        }

        document.getElementById('hp-bar').style.width = `${(player.hp / player.maxHp) * 100}%`;
        document.getElementById('hp-text').innerText = `${Math.ceil(player.hp)}%`;
        document.getElementById('dna-count').innerText = totalDna;
        document.getElementById('timer-display').innerText = `00:${timerRemaining.toFixed(1).padStart(4, '0')}`;
    }

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    drawParallaxBackground(ctx, camera);
    drawWorldTiles(ctx, camera);
    drawMiningReticle(ctx, camera);
    preyList.forEach(prey => prey.draw(ctx, camera));
    therizinoList.forEach(th => th.draw(ctx, camera));
    carnoList.forEach(cn => cn.draw(ctx, camera));
    player.draw(ctx, camera);
    particleList.forEach(p => p.draw(ctx, camera));

    if (gameState === 'PLAYING' && timerRemaining < 10) {
        ctx.fillStyle = '#f97316';
        for (let i = 0; i < 5; i++) {
            const rx = (Math.random() * CANVAS_WIDTH);
            const ry = (Math.random() * CANVAS_HEIGHT);
            ctx.fillRect(rx, ry, 2, 8);
        }
    }

    drawMinimap(player);

    requestAnimationFrame(gameLoop);
}

generateWorld();
requestAnimationFrame(gameLoop);
